package io.github.matrixbridge.phone

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.nothing.ketchum.Glyph
import com.nothing.ketchum.GlyphMatrixManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The only place that touches Nothing's SDK.
 *
 * There are two ways to draw, and which one is allowed depends on the phone's state:
 *  - App mode (`setAppMatrixFrame`): any app may draw, no toy needed. Needs
 *    Nothing OS from 2025-08-01 or later. A Glyph Toy always wins over it.
 *  - Toy mode (`setMatrixFrame`): only while one of our toys is the selected toy.
 *
 * The SDK hands out one shared GlyphMatrixManager, so the service and the toys
 * share it through acquire()/release() instead of each calling init()/unInit().
 *
 * What is drawn, first match wins:
 *  1. nothing, while [setHidden] says the matrix cannot be seen;
 *  2. the arrow, for a moment after the PC Remote toy is selected;
 *  3. the stored glyph, while the My Glyph toy is playing it ([playLocal]);
 *  4. the last frame from the PC ([show]);
 *  5. the arrow, if a toy is selected and there is nothing else.
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
    private var hidden = false

    /** True while we have LEDs on, so the matrix is only handed back when there is something to hand back. */
    private var lit = false

    /** How long the arrow shows after landing on the toy, before the PC's frame takes over. */
    private const val MARKER_MS = 1200L
    private val main = Handler(Looper.getMainLooper())
    private var markerUntil = 0L
    private val endMarker = Runnable { synchronized(lock) { redraw() } }

    /** Last frame from the PC, 0..255 per pixel. Null means nothing to show. */
    private var frame: IntArray? = null
    private var brightness = 255

    /** The stored glyph while the My Glyph toy plays it. */
    private var local: List<IntArray>? = null
    private var localDelay = 200L
    private var localIndex = 0
    private val stepLocal = object : Runnable {
        override fun run() {
            synchronized(lock) {
                val frames = local ?: return
                localIndex = (localIndex + 1) % frames.size
                redraw()
                if (frames.size > 1) main.postDelayed(this, localDelay)
            }
        }
    }

    private val _showing = MutableStateFlow<IntArray?>(null)

    /** What is on the matrix right now (0..255 per pixel, before brightness), for the app's own preview. Null when dark. */
    val showing: StateFlow<IntArray?> = _showing

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
            lit = false
            frame = null
            _showing.value = null
        }
    }

    /** Shows a frame from the PC (or the resting face). [px] is 625 values, 0..255. */
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
            redraw()
        }
    }

    /**
     * Goes dark without forgetting anything, and comes back the same way. Used when the
     * phone is lying on its back, where the matrix lights up the table and nothing else.
     */
    fun setHidden(value: Boolean) {
        synchronized(lock) {
            if (hidden == value) return
            hidden = value
            redraw()
        }
    }

    /** Loops the stored glyph until [stopLocal]. For the My Glyph toy. */
    fun playLocal(frames: List<IntArray>, delayMs: Int) {
        synchronized(lock) {
            main.removeCallbacks(stepLocal)
            if (frames.isEmpty()) {
                local = null
            } else {
                local = frames
                localDelay = delayMs.coerceIn(50, 1000).toLong()
                localIndex = 0
                if (frames.size > 1) main.postDelayed(stepLocal, localDelay)
            }
            redraw()
        }
    }

    fun stopLocal() {
        synchronized(lock) {
            main.removeCallbacks(stepLocal)
            local = null
            redraw()
        }
    }

    /**
     * Called by a toy when the user selects or leaves it with the Glyph Button.
     * [marker] flashes the arrow on arrival, so PC Remote is recognisable while cycling toys.
     */
    fun setToyActive(active: Boolean, marker: Boolean = true) {
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
            main.removeCallbacks(endMarker)
            markerUntil = if (active && marker) SystemClock.uptimeMillis() + MARKER_MS else 0L
            if (active && marker) main.postDelayed(endMarker, MARKER_MS)
            redraw()
        }
    }

    /** Works out what should be lit and puts it there. Call with [lock] held. */
    private fun redraw() {
        val marker = toyActive && SystemClock.uptimeMillis() < markerUntil
        val source: IntArray? = when {
            hidden -> null
            marker -> IDLE_FRAME
            local != null -> local!![localIndex]
            frame != null -> frame
            toyActive -> IDLE_FRAME
            else -> null
        }
        _showing.value = source
        if (source == null) {
            if (lit) blank()
            lit = false
            return
        }
        val gm = manager ?: return
        if (!connected) return
        val levels = IntArray(Protocol.PIXELS) { i -> source[i] * brightness / 255 * MAX_LEVEL / 255 }
        try {
            if (toyActive) gm.setMatrixFrame(levels) else gm.setAppMatrixFrame(levels)
            lit = true
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
