package io.github.matrixbridge.phone

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

// The PC app's palette: black and white dots, with red meaning "live".
private val Red = Color(0xFFE5262B)
private val Muted = Color(0xFF8C8C8C)
private val Line = Color(0xFF1F1F1F)
private val LineStrong = Color(0xFF363636)
private val UnlitDot = Color(0xFF1C1C1C)

class MainActivity : ComponentActivity() {

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* optional either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
        if (granted != PackageManager.PERMISSION_GRANTED) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color.White, onPrimary = Color.Black,
                    background = Color.Black, surface = Color.Black,
                    onBackground = Color.White, onSurface = Color.White,
                ),
            ) {
                // Surface sets the default text colour; without it plain Text is black on black.
                Surface(color = Color.Black, contentColor = Color.White) { BridgeScreen() }
            }
        }
    }
}

@Composable
private fun BridgeScreen() {
    val context = LocalContext.current
    val status by Bridge.status.collectAsStateWithLifecycle()
    val showing by MatrixDriver.showing.collectAsStateWithLifecycle()
    val store = remember { PairingStore(context) }
    var paired by remember { mutableStateOf(store.all()) }
    // The list changes when a PC pairs, which also changes the code.
    val shownPaired = remember(status.code, paired) { store.all() }

    var startOnBoot by remember { mutableStateOf(Prefs.startOnBoot(context)) }
    var hideOnBack by remember { mutableStateOf(Prefs.hideOnBack(context)) }
    var rest by remember { mutableStateOf(Prefs.rest(context)) }
    var glyphGone by remember { mutableStateOf(0) }
    val glyph = remember(status.glyph, glyphGone) { GlyphStore.load(context) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 20.dp),
    ) {
        // Same mark as the PC app: the name in the matrix's own 5x7 dot font.
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            DotText("MATRIX", cell = 3.2.dp, color = Color.White)
            DotText("MIXER", cell = 3.2.dp, color = Red)
        }

        Spacer(Modifier.height(26.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            MatrixPreview(showing, size = 220.dp)
        }
        Spacer(Modifier.height(22.dp))

        val linked = status.clients.isNotEmpty()
        Label(if (showing != null) "On the matrix" else "Dark", color = if (showing != null) Red else Muted)
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).background(if (linked) Red else if (status.running) Color.White else LineStrong, CircleShape))
            Spacer(Modifier.width(10.dp))
            Text(
                when {
                    !status.running -> "Off the line"
                    linked -> "Linked to ${status.clients.joinToString()}"
                    else -> "Waiting for your PC"
                },
                fontSize = 20.sp, fontWeight = FontWeight.SemiBold,
            )
        }
        status.error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Red, fontSize = 14.sp)
        }

        Spacer(Modifier.height(18.dp))
        if (status.running) {
            OutlinedButton(
                onClick = { BridgeService.stop(context) },
                border = BorderStroke(1.dp, LineStrong),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Stop") }
        } else {
            Button(onClick = { BridgeService.start(context) }, modifier = Modifier.fillMaxWidth()) { Text("Start") }
        }
        Spacer(Modifier.height(22.dp))

        if (status.running) {
            Section("Pair a PC") {
                Text(
                    status.code.chunked(3).joinToString(" "),
                    fontFamily = FontFamily.Monospace, fontSize = 44.sp, fontWeight = FontWeight.Bold, letterSpacing = 4.sp,
                )
                Hint("Type this into MatrixMixer on your PC. It changes after each pairing.")
                Spacer(Modifier.height(6.dp))
                if (status.addresses.isEmpty()) {
                    Text("Not on Wi-Fi", color = Muted)
                } else {
                    status.addresses.forEach {
                        Text("$it : ${status.port}", fontFamily = FontFamily.Monospace, fontSize = 16.sp)
                    }
                }
                Hint(
                    "Your PC should find this phone by itself. If it does not, type the address in. " +
                        "On networks that keep devices apart, plug in USB, run " +
                        "\"adb forward tcp:${status.port} tcp:${status.port}\" on the PC and connect to 127.0.0.1.",
                )
            }
        }

        Section("My Glyph") {
            if (glyph == null) {
                Text("Nothing kept on the phone yet.", fontSize = 15.sp)
                Hint("Draw a picture or an animation in MatrixMixer on your PC and press \"Keep on phone\". It stays here and shows without the PC.")
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MatrixPreview(glyph.frames[0], size = 72.dp)
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(glyph.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                        Hint(if (glyph.frames.size == 1) "A picture" else "${glyph.frames.size} frames, ${glyph.delayMs} ms each")
                    }
                    TextButton(onClick = {
                        GlyphStore.clear(context)
                        Bridge.update { it.copy(glyph = null) }
                        glyphGone++
                    }) { Text("Remove", color = Red) }
                }
                Hint("To show it without the PC, add the \"My Glyph\" toy and press the Glyph Button until it comes up.")
            }
        }

        Section("Glyph Button") {
            Text(
                if (status.toyActive) "PC Remote is selected. A long-press of the Glyph Button now reaches your PC."
                else "To use the Glyph Button as a PC button, add the \"PC Remote\" toy, then press the Glyph Button until its arrow shows.",
                fontSize = 15.sp,
            )
            Spacer(Modifier.height(4.dp))
            OutlinedButton(
                border = BorderStroke(1.dp, LineStrong),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                onClick = {
                    // Nothing's own screen for adding toys to the Glyph Button carousel.
                    val intent = Intent().setComponent(
                        ComponentName("com.nothing.thirdparty", "com.nothing.thirdparty.matrix.toys.manager.ToysManagerActivity"),
                    )
                    runCatching { context.startActivity(intent) }.onFailure {
                        Toast.makeText(context, "Open Settings > Glyph Interface > Glyph Toys instead", Toast.LENGTH_LONG).show()
                    }
                },
            ) { Text("Manage Glyph Toys") }
        }

        Section("On its own") {
            Toggle(
                "Start with the phone",
                "Listens for your PC after a restart, with no need to open this app. There is also a MatrixMixer tile for Quick Settings.",
                startOnBoot,
            ) {
                startOnBoot = it
                Prefs.setStartOnBoot(context, it)
            }
            Toggle(
                "Dark when lying on its back",
                "Screen up on a table, the matrix lights the table and nothing else. It comes back when you pick the phone up or turn it over.",
                hideOnBack,
            ) {
                hideOnBack = it
                Prefs.setHideOnBack(context, it)
                BridgeService.settingsChanged(context)
            }
            Spacer(Modifier.height(4.dp))
            Text("When the PC goes away", fontSize = 15.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(Prefs.Rest.DARK to "Go dark", Prefs.Rest.LAST to "Keep the last picture", Prefs.Rest.GLYPH to "My Glyph").forEach { (value, label) ->
                    Chip(label, on = rest == value) {
                        rest = value
                        Prefs.setRest(context, value)
                        BridgeService.settingsChanged(context)
                    }
                }
            }
            Hint(
                when (rest) {
                    Prefs.Rest.DARK -> "The matrix switches off 30 seconds after the last PC disconnects."
                    Prefs.Rest.LAST -> "Whatever the PC showed last stays lit."
                    Prefs.Rest.GLYPH -> if (glyph == null) "Shows My Glyph once you have kept one. Until then it goes dark." else "Shows \"${glyph.name}\" (its first frame) until the PC is back."
                },
            )
        }

        if (shownPaired.isNotEmpty()) {
            Section("Paired computers") {
                shownPaired.forEach { (token, name) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(name, Modifier.weight(1f), fontSize = 15.sp)
                        TextButton(onClick = {
                            store.remove(token)
                            paired = store.all()
                            BridgeService.pairingChanged(context)
                        }) { Text("Forget", color = Red) }
                    }
                }
            }
        }

        Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
        Spacer(Modifier.height(16.dp))
        Text("Community project. Not affiliated with or endorsed by Nothing.", color = Muted, fontSize = 12.sp)
    }
}

/** A flat, open section: a hairline, a small heading with the red dot, then the content. No box. */
@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
    Column(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(5.dp).background(Red, CircleShape))
            Spacer(Modifier.width(9.dp))
            Label(title)
        }
        Spacer(Modifier.height(2.dp))
        content()
    }
}

@Composable
private fun Label(text: String, color: Color = Muted) {
    Text(text.uppercase(), color = color, fontSize = 11.sp, fontFamily = FontFamily.Monospace, letterSpacing = 2.4.sp)
}

@Composable
private fun Hint(text: String) {
    Text(text, color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
}

@Composable
private fun Toggle(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 14.dp)) {
            Text(title, fontSize = 15.sp)
            Hint(hint)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Red, checkedTrackColor = Color.Black, checkedBorderColor = Color.White,
                uncheckedThumbColor = Muted, uncheckedTrackColor = Color.Black, uncheckedBorderColor = LineStrong,
            ),
        )
    }
}

@Composable
private fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    Text(
        text,
        color = if (on) Color.Black else Color.White,
        fontSize = 13.sp,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (on) Color.White else Color.Black)
            .border(1.dp, if (on) Color.White else LineStrong, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 8.dp),
    )
}

/** How many LEDs each of the 25 rows really has, centred: the matrix is round. Same table as core/src/frame.ts. */
private val ROW_WIDTHS = intArrayOf(7, 11, 15, 17, 19, 21, 21, 23, 23, 25, 25, 25, 25, 25, 25, 25, 23, 23, 21, 21, 19, 17, 15, 11, 7)

/** The matrix as dots: [frame] is 625 values, 0..255, or null for dark. */
@Composable
private fun MatrixPreview(frame: IntArray?, size: Dp) {
    Canvas(Modifier.size(size)) {
        val full = this.size.minDimension
        drawCircle(LineStrong, radius = full / 2 - 1f, style = Stroke(width = 1.dp.toPx()))
        // Leave a margin inside the ring, like the bezel around the real LEDs.
        val cell = full * 0.9f / Protocol.SIZE
        val origin = (full - cell * Protocol.SIZE) / 2
        for (y in 0 until Protocol.SIZE) {
            val pad = (Protocol.SIZE - ROW_WIDTHS[y]) / 2
            for (x in pad until Protocol.SIZE - pad) {
                val value = frame?.get(y * Protocol.SIZE + x) ?: 0
                drawCircle(
                    color = lerp(UnlitDot, Color.White, value / 255f),
                    radius = cell * 0.36f,
                    center = Offset(origin + (x + 0.5f) * cell, origin + (y + 0.5f) * cell),
                )
            }
        }
    }
}

/**
 * Letters of the classic 5x7 dot font the matrix itself uses (core/src/font.ts):
 * five columns each, bit 0 at the top. Only the ones this screen spells with.
 */
private val DOT_FONT: Map<Char, IntArray> = mapOf(
    'A' to intArrayOf(0x7E, 0x11, 0x11, 0x11, 0x7E),
    'E' to intArrayOf(0x7F, 0x49, 0x49, 0x49, 0x41),
    'I' to intArrayOf(0x00, 0x41, 0x7F, 0x41, 0x00),
    'M' to intArrayOf(0x7F, 0x02, 0x0C, 0x02, 0x7F),
    'R' to intArrayOf(0x7F, 0x09, 0x19, 0x29, 0x46),
    'T' to intArrayOf(0x01, 0x01, 0x7F, 0x01, 0x01),
    'X' to intArrayOf(0x63, 0x14, 0x08, 0x14, 0x63),
)

/** Text drawn as lit dots, one [cell] apart. */
@Composable
private fun DotText(text: String, cell: Dp, color: Color) {
    val columns = text.flatMap { c -> (DOT_FONT[c] ?: IntArray(5)).toList() + 0 }.dropLast(1)
    Canvas(Modifier.size(width = cell * columns.size, height = cell * 7)) {
        val step = cell.toPx()
        columns.forEachIndexed { x, bits ->
            for (y in 0 until 7) {
                if (bits shr y and 1 == 1) drawCircle(color, radius = step * 0.36f, center = Offset((x + 0.5f) * step, (y + 0.5f) * step))
            }
        }
    }
}
