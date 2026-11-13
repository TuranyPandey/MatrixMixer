package io.github.matrixbridge.phone

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.nothing.ketchum.Glyph
import com.nothing.ketchum.GlyphMatrixManager

/**
 * The only place that touches Nothing's SDK.
 *
 * There are two ways to draw, and which one is allowed depends on the phone's state:
 *  - App mode (`setAppMatrixFrame`): any app may draw, no toy needed. Needs
 *    Nothing OS from 2025-08-01 or later. A Glyph Toy always wins over it.
 *  - Toy mode (`setMatrixFrame`): only while our PC Remote toy is the selected toy.
 *
 * The SDK hands out one shared GlyphMatrixManager, so the service and the toy
 * share it through acquire()/release() instead of each calling init()/unInit().
 */
object MatrixDriver {
    private const val TAG = "MatrixDriver"

    /** The SDK takes brightness as 0..4095 per LED (GlyphMatrixUtils.MAX_BRIGHTNESS). */
    private const val MAX_LEVEL = 4095

    private val lock = Any()
    private var manager: GlyphMatrixManager? = null
    private var connected = false
    private var users = 0
    private var toyActive = false

    /** How long the arrow shows after landing on the toy, before the PC's frame takes over. */
    private const val MARKER_MS = 1200L
    private val main = Handler(Looper.getMainLooper())
    private var markerUntil = 0L
    private val endMarker = Runnable { synchronized(lock) { redraw() } }

    /** Last frame from the PC, 0..255 per pixel. Null means nothing to show. */
    private var frame: IntArray? = null
    private var brightness = 255

    fun acquire(context: Context) {
        synchronized(lock) {
            users++
            if (manager != null) return
            val gm = GlyphMatrixManager.getInstance(context.applicationContext)
            if (gm == null) {
                Log.e(TAG, "GlyphMatrixManager unavailable. Is this a Phone (3)?")
                return
            }
            manager = gm
            gm.init(object : GlyphMatrixManager.Callback {
                override fun onServiceConnected(name: ComponentName?) {
                    synchronized(lock) {
                        val ok = gm.register(Glyph.DEVICE_23112)
                        Log.i(TAG, "Glyph service connected, register=$ok")
                        connected = true
                        redraw()
                    }
                }

                override fun onServiceDisconnected(name: ComponentName?) {
                    synchronized(lock) { connected = false }
                }
            })
        }
    }

    fun release() {
        synchronized(lock) {
            users = (users - 1).coerceAtLeast(0)
            if (users > 0) return
            blank()
            try {
                manager?.unInit()
            } catch (e: Exception) {
                Log.w(TAG, "unInit failed", e)
            }
            manager = null
            connected = false
            frame = null
        }
    }

    /** Shows a frame from the PC. [px] is 625 values, 0..255. */
    fun show(px: IntArray) {
        synchronized(lock) {
            frame = px
            redraw()
        }
    }

    fun setBrightness(value: Int) {
        synchronized(lock) {
            brightness = value.coerceIn(0, 255)
            redraw()
        }
    }

    /** Forgets the PC's frame and turns the LEDs off. */
    fun clear() {
        synchronized(lock) {
            frame = null
            if (toyActive) redraw() else blank()
        }
    }

    /** Called by the toy when the user selects or leaves it with the Glyph Button. */
    fun setToyActive(active: Boolean) {
        synchronized(lock) {
            if (toyActive == active) return
            if (!active) {
                // Leaving the toy: hand the matrix back, then carry on in app mode if the PC is still sending.
                try {
                    manager?.turnOff()
                } catch (e: Exception) {
                    Log.w(TAG, "turnOff failed", e)
                }
            }
            toyActive = active
            // Flash the arrow on arrival, so the toy is recognisable even while the PC is sending frames.
            main.removeCallbacks(endMarker)
            markerUntil = if (active) SystemClock.uptimeMillis() + MARKER_MS else 0L
            if (active) main.postDelayed(endMarker, MARKER_MS)
            redraw()
        }
    }

    private fun redraw() {
        val gm = manager ?: return
        if (!connected) return
        val px = frame
        if (px == null && !toyActive) return
        // Just after the toy is selected, or with nothing from the PC yet, show a marker so
        // it is obvious which toy this is while cycling with the Glyph Button.
        val marker = toyActive && SystemClock.uptimeMillis() < markerUntil
        val source = if (px == null || marker) IDLE_FRAME else px
        val levels = IntArray(Protocol.PIXELS) { i -> source[i] * brightness / 255 * MAX_LEVEL / 255 }
        try {
            if (toyActive) gm.setMatrixFrame(levels) else gm.setAppMatrixFrame(levels)
        } catch (e: Exception) {
            Log.w(TAG, "Could not draw frame", e)
        }
    }

    private fun blank() {
        val gm = manager ?: return
        if (!connected) return
        try {
            if (toyActive) gm.setMatrixFrame(IntArray(Protocol.PIXELS)) else gm.closeAppMatrix()
        } catch (e: Exception) {
            Log.w(TAG, "Could not blank the matrix", e)
        }
    }

    /** A two-headed arrow, the same mark as the app icon. */
    private val IDLE_FRAME: IntArray by lazy {
        val art = arrayOf(
            "..#.....#..",
            ".##.....##.",
            "###########",
            ".##.....##.",
            "..#.....#..",
        )
        val out = IntArray(Protocol.PIXELS)
        val x0 = (Protocol.SIZE - art[0].length) / 2
        val y0 = (Protocol.SIZE - art.size) / 2
        art.forEachIndexed { y, row ->
            row.forEachIndexed { x, c -> if (c == '#') out[(y0 + y) * Protocol.SIZE + x0 + x] = 255 }
        }
        out
    }
}
