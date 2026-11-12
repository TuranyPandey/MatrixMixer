package io.github.matrixbridge.phone

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64

/** What the app screen shows. */
data class BridgeStatus(
    val running: Boolean = false,
    val port: Int = Protocol.DEFAULT_PORT,
    /** 6-digit code a new PC must type. Empty while the service is stopped. */
    val code: String = "",
    /** Names of the PCs connected right now. */
    val clients: List<String> = emptyList(),
    /** True while the PC Remote toy is the selected Glyph Toy. */
    val toyActive: Boolean = false,
    /** This phone's Wi-Fi addresses, for typing into the PC by hand. */
    val addresses: List<String> = emptyList(),
    val error: String? = null,
)

/**
 * Process-wide meeting point for the three components: the foreground service
 * (network), the Glyph Toy (button) and the activity (screen).
 */
object Bridge {
    private val _status = MutableStateFlow(BridgeStatus())
    val status: StateFlow<BridgeStatus> = _status

    /** Called from several threads (server, main), so changes are applied one at a time. */
    @Synchronized
    fun update(change: (BridgeStatus) -> BridgeStatus) {
        _status.value = change(_status.value)
    }

    /** Set by the service while it runs. The toy calls these. */
    @Volatile
    var onButton: ((action: String) -> Unit)? = null

    @Volatile
    var onToyChanged: ((active: Boolean) -> Unit)? = null
}

/** What the server needs to know about pairing. An interface so tests can run without Android. */
interface Pairings {
    /** Name of the PC this token belongs to, or null if it is not paired. */
    fun nameFor(token: String): String?

    /** Creates and stores a token for a newly paired PC. */
    fun add(name: String): String

    /** A fresh 6-digit code. */
    fun newCode(): String
}

/** Remembers which PCs have paired. Tokens are random and only ever leave the phone once. */
class PairingStore(context: Context) : Pairings {
    private val prefs = context.applicationContext.getSharedPreferences("pairing", Context.MODE_PRIVATE)
    private val random = SecureRandom()

    /** token -> PC name */
    @Synchronized
    fun all(): Map<String, String> {
        val json = JSONObject(prefs.getString(KEY, "{}") ?: "{}")
        return json.keys().asSequence().associateWith { json.optString(it, "PC") }
    }

    @Synchronized
    override fun nameFor(token: String): String? = all()[token]

    @Synchronized
    override fun add(name: String): String {
        val bytes = ByteArray(24).also(random::nextBytes)
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        save(all() + (token to name))
        return token
    }

    @Synchronized
    fun remove(token: String) = save(all() - token)

    private fun save(map: Map<String, String>) {
        val json = JSONObject()
        map.forEach { (token, name) -> json.put(token, name) }
        prefs.edit().putString(KEY, json.toString()).apply()
    }

    override fun newCode(): String = "%06d".format(random.nextInt(1_000_000))

    private companion object {
        const val KEY = "tokens"
    }
}
