package io.github.matrixbridge.phone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** The few choices the phone app remembers. */
object Prefs {
    /** What the matrix does once the last PC has gone. */
    enum class Rest { DARK, LAST, GLYPH }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** Start listening for the PC when the phone starts. */
    fun startOnBoot(context: Context): Boolean = prefs(context).getBoolean("startOnBoot", false)
    fun setStartOnBoot(context: Context, value: Boolean) = prefs(context).edit().putBoolean("startOnBoot", value).apply()

    /**
     * True from Start until the user stops the bridge themselves. An app update
     * kills the service; this is how it knows to come back afterwards.
     */
    fun wantRunning(context: Context): Boolean = prefs(context).getBoolean("wantRunning", false)
    fun setWantRunning(context: Context, value: Boolean) = prefs(context).edit().putBoolean("wantRunning", value).apply()

    /** Go dark while the phone lies on its back, where the matrix cannot be seen. */
    fun hideOnBack(context: Context): Boolean = prefs(context).getBoolean("hideOnBack", false)
    fun setHideOnBack(context: Context, value: Boolean) = prefs(context).edit().putBoolean("hideOnBack", value).apply()

    fun rest(context: Context): Rest =
        runCatching { Rest.valueOf(prefs(context).getString("rest", null) ?: "DARK") }.getOrDefault(Rest.DARK)

    fun setRest(context: Context, value: Rest) = prefs(context).edit().putString("rest", value.name).apply()
}

/** A picture or animation a PC asked the phone to keep. Frames are finished: the phone only replays them. */
class SavedGlyph(val name: String, val frames: List<IntArray>, val delayMs: Int)

/** Keeps one glyph in a file, so it is still there after a restart and with no PC around. */
object GlyphStore {
    private const val FILE = "glyph.json"

    @Volatile
    private var cached: SavedGlyph? = null

    @Volatile
    private var loaded = false

    @Synchronized
    fun load(context: Context): SavedGlyph? {
        if (loaded) return cached
        loaded = true
        cached = runCatching {
            val json = JSONObject(File(context.applicationContext.filesDir, FILE).readText())
            val list = json.getJSONArray("frames")
            val frames = (0 until list.length()).map { f ->
                val row = list.getJSONArray(f)
                require(row.length() == Protocol.PIXELS)
                IntArray(Protocol.PIXELS) { row.getInt(it).coerceIn(0, 255) }
            }
            require(frames.isNotEmpty())
            SavedGlyph(json.optString("name", "Glyph"), frames, json.optInt("delay", 200))
        }.getOrNull()
        return cached
    }

    @Synchronized
    fun save(context: Context, glyph: SavedGlyph) {
        cached = glyph
        loaded = true
        val json = JSONObject()
            .put("name", glyph.name)
            .put("delay", glyph.delayMs)
            .put("frames", JSONArray(glyph.frames.map { frame -> JSONArray(frame.toList()) }))
        runCatching { File(context.applicationContext.filesDir, FILE).writeText(json.toString()) }
    }

    @Synchronized
    fun clear(context: Context) {
        cached = null
        loaded = true
        runCatching { File(context.applicationContext.filesDir, FILE).delete() }
    }
}
