package io.github.matrixbridge.phone

import android.util.Log
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress

/**
 * The phone side of the protocol: pairing, auth and message routing.
 * It knows nothing about LEDs; frames are handed to [Host].
 * `cli/src/sim.ts` is a TypeScript copy of these rules for testing. Keep them in step.
 */
class BridgeServer(
    port: Int,
    private val store: Pairings,
    private val host: Host,
) : WebSocketServer(InetSocketAddress(port)) {

    interface Host {
        val deviceName: String
        val toyActive: Boolean
        fun onFrame(px: IntArray)
        fun onBrightness(value: Int)
        fun onClear()
        /** Names of connected, paired PCs. Called whenever the list changes. */
        fun onClientsChanged(names: List<String>)
        fun onCodeChanged(code: String)
        fun onStarted()
        fun onFailed(message: String)
    }

    /** Per-connection state, kept on the socket as its attachment. */
    private class Session {
        @Volatile var authed = false
        @Volatile var name = "PC"
    }

    private val lock = Any()
    private var code = store.newCode()
    private var badCodes = 0
    private var lockedUntil = 0L

    init {
        isReuseAddr = true
        // Drops clients that stop answering WebSocket pings (PC asleep, Wi-Fi gone).
        connectionLostTimeout = 15
    }

    val currentCode: String
        get() = synchronized(lock) { code }

    override fun onStart() {
        host.onCodeChanged(currentCode)
        host.onStarted()
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        conn.setAttachment(Session())
        conn.send(Protocol.hello(host.deviceName))
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
        publishClients()
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        Log.w(TAG, "Socket error", ex)
        // A null connection means the server itself failed, usually because the port is taken.
        if (conn == null) host.onFailed(ex.message ?: ex.javaClass.simpleName)
    }

    override fun onMessage(conn: WebSocket, message: String) {
        val session = conn.getAttachment<Session>() ?: return
        val msg = Protocol.parse(message)
        if (msg == null) {
            conn.send(Protocol.error("bad_message", "Could not read that message"))
            return
        }

        when (msg) {
            is Protocol.PcMessage.Ping -> conn.send(Protocol.pong())
            // Already in: ignore. Answering would spend (and rotate) the code for nothing.
            is Protocol.PcMessage.Pair -> if (!session.authed) pair(conn, session, msg)
            is Protocol.PcMessage.Auth -> {
                val known = store.nameFor(msg.token)
                if (known == null) {
                    conn.send(Protocol.error("bad_token", "This computer is not paired"))
                } else {
                    accept(conn, session, msg.name ?: known)
                }
            }

            else -> {
                if (!session.authed) {
                    conn.send(Protocol.error("unauthorized", "Pair first"))
                    return
                }
                when (msg) {
                    is Protocol.PcMessage.Frame -> host.onFrame(msg.px)
                    is Protocol.PcMessage.Brightness -> host.onBrightness(msg.value)
                    is Protocol.PcMessage.Clear -> host.onClear()
                    else -> Unit
                }
            }
        }
    }

    private fun pair(conn: WebSocket, session: Session, msg: Protocol.PcMessage.Pair) {
        // Decide under the lock, talk to the socket after it.
        var failure: String? = null
        var token: String? = null
        synchronized(lock) {
            val now = System.currentTimeMillis()
            if (now < lockedUntil) {
                failure = Protocol.error("locked", "Too many wrong codes. Wait 30 seconds.")
            } else if (msg.code != code) {
                if (++badCodes >= MAX_BAD_CODES) {
                    badCodes = 0
                    lockedUntil = now + LOCK_MS
                    code = store.newCode()
                    host.onCodeChanged(code)
                }
                failure = Protocol.error("bad_code", "That code does not match the phone")
            } else {
                badCodes = 0
                token = store.add(msg.name)
                // One code, one PC: a code someone glimpsed cannot be reused.
                code = store.newCode()
                host.onCodeChanged(code)
            }
        }
        val granted = token
        if (granted == null) {
            conn.send(failure ?: Protocol.error("bad_code", "Pairing failed"))
            return
        }
        conn.send(Protocol.paired(granted))
        accept(conn, session, msg.name)
    }

    private fun accept(conn: WebSocket, session: Session, name: String) {
        session.name = name
        session.authed = true
        conn.send(Protocol.ready())
        conn.send(Protocol.status(host.toyActive))
        publishClients()
    }

    private fun authedConnections(): List<WebSocket> =
        connections.filter { it.isOpen && it.getAttachment<Session>()?.authed == true }

    private fun publishClients() {
        host.onClientsChanged(authedConnections().mapNotNull { it.getAttachment<Session>()?.name })
    }

    /** [action] is "down", "up" or "long". */
    fun sendButton(action: String) {
        val text = Protocol.buttonEvent(action)
        authedConnections().forEach { it.send(text) }
    }

    fun sendToyStatus(active: Boolean) {
        val text = Protocol.status(active)
        authedConnections().forEach { it.send(text) }
    }

    /** Disconnects a PC whose pairing was just removed in the app. */
    fun dropUnpaired() {
        // Tokens are not kept per session, so the simple, safe option is to make everyone re-authenticate.
        connections.toList().forEach { it.close(1000, "Pairing changed") }
    }

    private companion object {
        const val TAG = "BridgeServer"
        const val MAX_BAD_CODES = 5
        const val LOCK_MS = 30_000L
    }
}
