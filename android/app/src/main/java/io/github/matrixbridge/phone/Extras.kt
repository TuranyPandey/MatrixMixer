package io.github.matrixbridge.phone

import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Messenger
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

/**
 * Brings the bridge back without anyone opening the app: when the phone starts
 * (if the user asked for that), and after an app update, which stops the service.
 */
class StartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val start = when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> Prefs.startOnBoot(context)
            Intent.ACTION_MY_PACKAGE_REPLACED -> Prefs.wantRunning(context)
            else -> false
        }
        Log.i("StartReceiver", "${intent.action}: start=$start")
        if (start) runCatching { BridgeService.start(context) }.onFailure { Log.w("StartReceiver", "Could not start", it) }
    }
}

/** A Quick Settings tile that starts and stops the bridge. */
class BridgeTileService : TileService() {
    override fun onStartListening() = refresh(Bridge.status.value.running)

    override fun onClick() {
        val running = Bridge.status.value.running
        if (running) BridgeService.stop(this) else runCatching { BridgeService.start(this) }
        // The service takes a moment either way; show where it is heading.
        refresh(!running)
    }

    private fun refresh(running: Boolean) {
        val tile = qsTile ?: return
        tile.state = if (running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.subtitle = if (running) "Listening for your PC" else "Off"
        tile.updateTile()
    }

    companion object {
        /** Asks the system to redraw the tile. Called when the service starts and stops. */
        fun requestRefresh(context: Context) {
            runCatching { requestListeningState(context, ComponentName(context, BridgeTileService::class.java)) }
        }
    }
}

/**
 * The "My Glyph" Glyph Toy: loops the picture or animation a PC stored on the
 * phone. It needs no PC and no running bridge, so the drawing stays with the phone.
 */
class MyGlyphToyService : Service() {
    // The system expects a Messenger to send button events to. This toy has no use for them.
    private val messenger = Messenger(Handler(Looper.getMainLooper()))

    override fun onBind(intent: Intent?): IBinder {
        Log.d(TAG, "Toy selected")
        MatrixDriver.acquire(applicationContext)
        MatrixDriver.setToyActive(true, marker = false)
        GlyphStore.load(applicationContext)?.let { MatrixDriver.playLocal(it.frames, it.delayMs) }
        return messenger.binder
    }

    override fun onUnbind(intent: Intent?): Boolean {
        Log.d(TAG, "Toy deselected")
        MatrixDriver.stopLocal()
        MatrixDriver.setToyActive(false)
        MatrixDriver.release()
        return false
    }

    private companion object {
        const val TAG = "MyGlyphToy"
    }
}
