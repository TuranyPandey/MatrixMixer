package io.github.matrixbridge.phone

import org.json.JSONException
import org.json.JSONObject

/**
 * Matrix Bridge wire protocol, version 1. JSON text over WebSocket.
 * The TypeScript side of this lives in core/src/protocol.ts and the full
 * conversation is written up in docs/PROTOCOL.md. Change all three together.
 */
object Protocol {
    const val VERSION = 1
    const val DEFAULT_PORT = 8765
    const val SERVICE_TYPE = "_matrixbridge._tcp"
    const val SIZE = 25
    const val PIXELS = SIZE * SIZE

    /** A message from the PC, already validated. */
    sealed class PcMessage {
        data class Pair(val code: String, val name: String) : PcMessage()
        data class Auth(val token: String, val name: String?) : PcMessage()
        class Frame(val px: IntArray) : PcMessage()
        data class Brightness(val value: Int) : PcMessage()
        data object Clear : PcMessage()
        data object Ping : PcMessage()
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
                val array = json.optJSONArray("px") ?: return null
                if (array.length() != PIXELS) return null
                val px = IntArray(PIXELS)
                for (i in 0 until PIXELS) {
                    val raw = array.opt(i)
                    // Whole numbers only: 1.5 or "12" are rejected rather than rounded.
                    val v = when (raw) {
                        is Int -> raw
                        is Long -> if (raw in 0..255) raw.toInt() else return null
                        else -> return null
                    }
                    if (v !in 0..255) return null
                    px[i] = v
                }
                PcMessage.Frame(px)
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

    fun hello(deviceName: String): String = JSONObject()
        .put("t", "hello").put("v", VERSION).put("device", "phone3")
        .put("name", deviceName).put("size", SIZE).toString()

    fun paired(token: String): String = JSONObject().put("t", "paired").put("token", token).toString()

    fun ready(): String = """{"t":"ready"}"""

    fun pong(): String = """{"t":"pong"}"""

    fun status(toyActive: Boolean): String = JSONObject().put("t", "status").put("toy", toyActive).toString()

    /** [action] is "down", "up" or "long". */
    fun buttonEvent(action: String): String = JSONObject()
        .put("t", "event").put("source", "button").put("action", action).toString()

    /** [code] is one of bad_code, bad_token, unauthorized, bad_message, locked. */
    fun error(code: String, message: String): String = JSONObject()
        .put("t", "error").put("code", code).put("message", message).toString()
}
