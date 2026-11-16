package io.github.matrixbridge.phone

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * MatrixMixer wire protocol, version 1. JSON text over WebSocket.
 * The TypeScript side of this lives in core/src/protocol.ts and the full
 * conversation is written up in docs/PROTOCOL.md. Change all three together.
 */
object Protocol {
    const val VERSION = 1
    const val DEFAULT_PORT = 8765
    const val SERVICE_TYPE = "_matrixbridge._tcp"
    const val SIZE = 25
    const val PIXELS = SIZE * SIZE

    /** The most frames a stored glyph may have. */
    const val MAX_STORED_FRAMES = 24

    /** A message from the PC, already validated. */
    sealed class PcMessage {
        data class Pair(val code: String, val name: String) : PcMessage()
        data class Auth(val token: String, val name: String?) : PcMessage()
        class Frame(val px: IntArray) : PcMessage()
        data class Brightness(val value: Int) : PcMessage()
        data object Clear : PcMessage()
        data object Ping : PcMessage()

        /** A picture or animation to keep on the phone. [delayMs] is per frame, 50..1000. */
        class Store(val name: String, val frames: List<IntArray>, val delayMs: Int) : PcMessage()
    }

    private val CODE = Regex("^\\d{6}$")

    /** Returns null for anything malformed, so the caller can answer `bad_message`. */
    fun parse(text: String): PcMessage? {
        val json = try {
            JSONObject(text)
        } catch (e: JSONException) {
            return null
        }
        return when (json.optString("t")) {
            "pair" -> {
                val code = json.opt("code") as? String ?: return null
                if (!CODE.matches(code)) return null
                PcMessage.Pair(code, (json.opt("name") as? String ?: "PC").take(64))
            }

            "auth" -> {
                val token = json.opt("token") as? String ?: return null
                if (token.isEmpty() || token.length > 256) return null
                PcMessage.Auth(token, (json.opt("name") as? String)?.take(64))
            }

            "frame" -> {
                PcMessage.Frame(pixels(json.optJSONArray("px")) ?: return null)
            }

            "store" -> {
                val list = json.optJSONArray("frames") ?: return null
                if (list.length() !in 1..MAX_STORED_FRAMES) return null
                val frames = (0 until list.length()).map { pixels(list.optJSONArray(it)) ?: return null }
                val delay = json.opt("delay") as? Int ?: return null
                if (delay !in 50..1000) return null
                PcMessage.Store((json.opt("name") as? String ?: "Glyph").take(40), frames, delay)
            }

            "brightness" -> {
                val v = json.opt("value") as? Int ?: return null
                if (v !in 0..255) return null
                PcMessage.Brightness(v)
            }

            "clear" -> PcMessage.Clear
            "ping" -> PcMessage.Ping
            else -> null
        }
    }

    /** One frame: exactly 625 whole numbers, 0..255. Null for anything else. */
    private fun pixels(array: JSONArray?): IntArray? {
        if (array == null || array.length() != PIXELS) return null
        val px = IntArray(PIXELS)
        for (i in 0 until PIXELS) {
            // Whole numbers only: 1.5 or "12" are rejected rather than rounded.
            val v = when (val raw = array.opt(i)) {
                is Int -> raw
                is Long -> if (raw in 0..255) raw.toInt() else return null
                else -> return null
            }
            if (v !in 0..255) return null
            px[i] = v
        }
        return px
    }

    fun hello(deviceName: String): String = JSONObject()
        .put("t", "hello").put("v", VERSION).put("device", "phone3")
        .put("name", deviceName).put("size", SIZE).toString()

    fun paired(token: String): String = JSONObject().put("t", "paired").put("token", token).toString()

    fun ready(): String = """{"t":"ready"}"""

    fun pong(): String = """{"t":"pong"}"""

    fun stored(name: String): String = JSONObject().put("t", "stored").put("name", name).toString()

    /** [level] is 0..100. */
    fun battery(level: Int, charging: Boolean): String = JSONObject()
        .put("t", "battery").put("level", level.coerceIn(0, 100)).put("charging", charging).toString()

    fun status(toyActive: Boolean): String = JSONObject().put("t", "status").put("toy", toyActive).toString()

    /** [action] is "down", "up" or "long". */
    fun buttonEvent(action: String): String = JSONObject()
        .put("t", "event").put("source", "button").put("action", action).toString()

    /** [code] is one of bad_code, bad_token, unauthorized, bad_message, locked. */
    fun error(code: String, message: String): String = JSONObject()
        .put("t", "error").put("code", code).put("message", message).toString()
}
