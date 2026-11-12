package io.github.matrixbridge.phone

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.util.Log
import com.nothing.ketchum.GlyphToy

/**
 * The "PC Remote" Glyph Toy.
 *
 * Nothing OS only tells an app about the Glyph Button while that app's toy is
 * the selected one, so this toy is how button presses reach the PC:
 *  - long-press  -> "long"  (Nothing calls this the `change` event)
 *  - touch down / up -> "down" / "up"
 * A short press is not delivered to anyone; it moves on to the next toy.
 *
 * While selected it also shows whatever the PC is sending, in toy mode, which
 * works on Nothing OS versions that predate app-mode drawing.
 */
class PcRemoteToyService : Service() {

    private val handler = object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(msg: Message) {
            if (msg.what != GlyphToy.MSG_GLYPH_TOY) return super.handleMessage(msg)
            when (msg.data?.getString(GlyphToy.MSG_GLYPH_TOY_DATA)) {
                GlyphToy.EVENT_CHANGE -> Bridge.onButton?.invoke("long")
                GlyphToy.EVENT_ACTION_DOWN -> Bridge.onButton?.invoke("down")
                GlyphToy.EVENT_ACTION_UP -> Bridge.onButton?.invoke("up")
            }
        }
    }
    private val messenger = Messenger(handler)

    /** The system binds this service when the user lands on the toy. */
    override fun onBind(intent: Intent?): IBinder {
        Log.d(TAG, "Toy selected")
        MatrixDriver.acquire(applicationContext)
        MatrixDriver.setToyActive(true)
        notifyToy(true)
        return messenger.binder
    }

    /** ...and unbinds it when they move on to the next toy. */
    override fun onUnbind(intent: Intent?): Boolean {
        Log.d(TAG, "Toy deselected")
        MatrixDriver.setToyActive(false)
        MatrixDriver.release()
        notifyToy(false)
        return false
    }

    private fun notifyToy(active: Boolean) {
        // The service may not be running; the status still needs to be right for the app screen.
        Bridge.onToyChanged?.invoke(active) ?: Bridge.update { it.copy(toyActive = active) }
    }

    private companion object {
        const val TAG = "PcRemoteToy"
    }
}
