package io.github.matrixbridge.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.BatteryManager
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Keeps the phone reachable from the PC: runs the WebSocket server, announces it
 * on the network, and draws incoming frames. A foreground service, so Android
 * leaves it alone when the screen is off.
 */
class BridgeService : Service(), BridgeServer.Host {

    private val main = Handler(Looper.getMainLooper())
    private var server: BridgeServer? = null
    private var nsdListener: NsdManager.RegistrationListener? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    // Frames can arrive faster than the LEDs need. Keep only the newest and draw at most ~30 a second.
    private val frameLock = Any()
    private var pendingFrame: IntArray? = null
    private var drawScheduled = false
    private var lastDrawAt = 0L

    private val blankWhenIdle = Runnable { MatrixDriver.clear() }

    /** This phone's battery as (level, charging). Reported to the PC. */
    @Volatile
    override var battery: Pair<Int, Boolean>? = null
        private set

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = readBattery(intent)
    }

    // Lying on its back, the matrix faces the table. Gravity along z says which way up the phone is.
    private var onBackSince = 0L
    private val tilt = object : SensorEventListener {
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

        override fun onSensorChanged(event: SensorEvent) {
            val z = event.values[2]
            val now = SystemClock.uptimeMillis()
            when {
                // Flat, screen up: wait a moment so a wobble on the way down does not blink the matrix.
                z > ON_BACK_Z -> {
                    if (onBackSince == 0L) onBackSince = now
                    if (now - onBackSince >= ON_BACK_MS) MatrixDriver.setHidden(true)
                }
                // Clearly picked up or turned over: come back at once.
                z < OFF_BACK_Z -> {
                    onBackSince = 0L
                    MatrixDriver.setHidden(false)
                }
            }
        }
    }
    private var tiltOn = false

    override val deviceName: String get() = Build.MODEL ?: "Phone"
    override val toyActive: Boolean get() = Bridge.status.value.toyActive

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(
            NOTIFICATION_ID,
            buildNotification(0),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
        )
        MatrixDriver.acquire(this)
        Prefs.setWantRunning(this, true)
        // The system answers with the current battery state straight away, then on every change.
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.let(::readBattery)
        applySettings()

        Bridge.onButton = { action -> server?.sendButton(action) }
        Bridge.onToyChanged = { active ->
            Bridge.update { it.copy(toyActive = active) }
            server?.sendToyStatus(active)
        }

        val store = PairingStore(this)
        server = BridgeServer(Protocol.DEFAULT_PORT, store, this).also { it.start() }
        Bridge.update {
            it.copy(running = true, port = Protocol.DEFAULT_PORT, addresses = localAddresses(), error = null, glyph = GlyphStore.load(this)?.name)
        }
        BridgeTileService.requestRefresh(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Prefs.setWantRunning(this, false)
                stopSelf()
            }
            ACTION_SETTINGS_CHANGED -> applySettings()
            ACTION_PAIRING_CHANGED -> server?.dropUnpaired()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Bridge.onButton = null
        Bridge.onToyChanged = null
        main.removeCallbacksAndMessages(null)
        runCatching { unregisterReceiver(batteryReceiver) }
        watchTilt(false)
        MatrixDriver.setHidden(false)
        unregisterNsd()
        val s = server
        server = null
        // stop() waits for sockets to close, so keep it off the main thread.
        Thread { runCatching { s?.stop(500) } }.start()
        releaseLocks()
        MatrixDriver.clear()
        MatrixDriver.release()
        Bridge.update { BridgeStatus(toyActive = it.toyActive, glyph = it.glyph) }
        BridgeTileService.requestRefresh(this)
        super.onDestroy()
    }

    // ---- BridgeServer.Host (called on the server's threads) --------------------

    override fun onStarted() {
        main.post { registerNsd() }
    }

    override fun onFailed(message: String) {
        Bridge.update { it.copy(error = "Could not start: $message") }
        main.post { stopSelf() }
    }

    override fun onCodeChanged(code: String) {
        Bridge.update { it.copy(code = code) }
    }

    override fun onFrame(px: IntArray) {
        synchronized(frameLock) {
            pendingFrame = px
            if (drawScheduled) return
            drawScheduled = true
            val wait = (MIN_FRAME_MS - (SystemClock.uptimeMillis() - lastDrawAt)).coerceAtLeast(0)
            main.postDelayed(::drawPending, wait)
        }
    }

    private fun drawPending() {
        val px = synchronized(frameLock) {
            drawScheduled = false
            lastDrawAt = SystemClock.uptimeMillis()
            pendingFrame.also { pendingFrame = null }
        }
        if (px != null) MatrixDriver.show(px)
    }

    override fun onBrightness(value: Int) = MatrixDriver.setBrightness(value)

    override fun onClear() {
        synchronized(frameLock) { pendingFrame = null }
        MatrixDriver.clear()
    }

    override fun onStore(name: String, frames: List<IntArray>, delayMs: Int) {
        GlyphStore.save(this, SavedGlyph(name, frames, delayMs))
        Bridge.update { it.copy(glyph = name) }
    }

    override fun onClientsChanged(names: List<String>) {
        Bridge.update { it.copy(clients = names) }
        main.post {
            main.removeCallbacks(blankWhenIdle)
            if (names.isEmpty()) {
                // Nobody connected: let go of the radios, then do what the user chose for the matrix.
                releaseLocks()
                rest()
            } else {
                acquireLocks()
            }
            getSystemService(NotificationManager::class.java)
                ?.notify(NOTIFICATION_ID, buildNotification(names.size))
        }
    }

    /** The last PC has gone. Go dark after a grace period, keep the last frame, or show the stored glyph. */
    private fun rest() {
        val glyph = GlyphStore.load(this)
        when (Prefs.rest(this)) {
            Prefs.Rest.LAST -> Unit
            // Its first frame only: with no PC connected nothing keeps the phone awake to animate it.
            Prefs.Rest.GLYPH -> if (glyph != null) MatrixDriver.show(glyph.frames[0]) else main.postDelayed(blankWhenIdle, IDLE_BLANK_MS)
            Prefs.Rest.DARK -> main.postDelayed(blankWhenIdle, IDLE_BLANK_MS)
        }
    }

    // ---- settings, battery, which way up ---------------------------------------------

    /** Re-reads the choices made in the app. Called at start and whenever one changes. */
    private fun applySettings() {
        watchTilt(Prefs.hideOnBack(this))
        if (Bridge.status.value.clients.isEmpty() && server != null) {
            main.removeCallbacks(blankWhenIdle)
            rest()
        }
    }

    private fun watchTilt(on: Boolean) {
        if (on == tiltOn) return
        val sensors = getSystemService(SensorManager::class.java) ?: return
        if (on) {
            val gravity = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
            sensors.registerListener(tilt, gravity, SensorManager.SENSOR_DELAY_NORMAL)
        } else {
            sensors.unregisterListener(tilt)
            onBackSince = 0L
            MatrixDriver.setHidden(false)
        }
        tiltOn = on
    }

    private fun readBattery(intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        if (level < 0 || scale <= 0) return
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val now = (level * 100 / scale) to (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL)
        if (now == battery) return
        battery = now
        server?.sendBattery(now.first, now.second)
    }

    // ---- network discovery ------------------------------------------------------

    private fun registerNsd() {
        if (nsdListener != null || server == null) return
        val info = NsdServiceInfo().apply {
            serviceName = "MatrixMixer on $deviceName"
            serviceType = Protocol.SERVICE_TYPE
            port = Protocol.DEFAULT_PORT
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) = Unit
            override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) = Unit
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                // Not fatal: the PC can still connect by IP address or over USB.
                Log.w(TAG, "mDNS registration failed: $errorCode")
            }
        }
        try {
            val nsd = getSystemService(NsdManager::class.java) ?: return
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
            nsdListener = listener
        } catch (e: Exception) {
            Log.w(TAG, "mDNS unavailable", e)
        }
    }

    private fun unregisterNsd() {
        val listener = nsdListener ?: return
        nsdListener = null
        runCatching { getSystemService(NsdManager::class.java)?.unregisterService(listener) }
    }

    private fun localAddresses(): List<String> = runCatching {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .mapNotNull { it.hostAddress }
            .toList()
    }.getOrDefault(emptyList())

    // ---- staying awake ------------------------------------------------------------

    private fun acquireLocks() {
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager::class.java)
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MatrixBridge:server")
                ?.apply { setReferenceCounted(false); acquire(MAX_WAKE_MS) }
        }
        if (wifiLock == null) {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            @Suppress("DEPRECATION") // LOW_LATENCY only works with the screen on; this must work with it off.
            wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "MatrixBridge:wifi")
                ?.apply { setReferenceCounted(false); acquire() }
        }
    }

    private fun releaseLocks() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        runCatching { wifiLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
        wifiLock = null
    }

    // ---- notification ---------------------------------------------------------------

    private fun createChannel() {
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW)
        channel.description = getString(R.string.channel_description)
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun buildNotification(clients: Int): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, BridgeService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val text = when (clients) {
            0 -> "Waiting for your PC"
            1 -> "Connected to 1 PC"
            else -> "Connected to $clients PCs"
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bridge)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .build()
    }

    companion object {
        private const val TAG = "BridgeService"
        private const val CHANNEL_ID = "bridge"
        private const val NOTIFICATION_ID = 1
        private const val MIN_FRAME_MS = 33L
        /** How long the last frame stays lit after the last PC disconnects. */
        private const val IDLE_BLANK_MS = 30_000L
        private const val MAX_WAKE_MS = 12 * 60 * 60 * 1000L
        const val ACTION_STOP = "io.github.matrixbridge.phone.STOP"
        const val ACTION_PAIRING_CHANGED = "io.github.matrixbridge.phone.PAIRING_CHANGED"
        const val ACTION_SETTINGS_CHANGED = "io.github.matrixbridge.phone.SETTINGS_CHANGED"
        /** Gravity along z (m/s2) above which the phone counts as lying on its back, and below which it does not. */
        private const val ON_BACK_Z = 8.8f
        private const val OFF_BACK_Z = 7.0f
        private const val ON_BACK_MS = 1500L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, BridgeService::class.java))
        }

        /** Stops because the user asked: it stays stopped until they start it again. */
        fun stop(context: Context) {
            Prefs.setWantRunning(context, false)
            context.stopService(Intent(context, BridgeService::class.java))
        }

        /** Tells a running service that a choice in the app changed. */
        fun settingsChanged(context: Context) {
            if (!Bridge.status.value.running) return
            context.startService(Intent(context, BridgeService::class.java).setAction(ACTION_SETTINGS_CHANGED))
        }

        /** Tells a running service that a PC was removed from the paired list. */
        fun pairingChanged(context: Context) {
            if (!Bridge.status.value.running) return
            context.startService(Intent(context, BridgeService::class.java).setAction(ACTION_PAIRING_CHANGED))
        }
    }
}
