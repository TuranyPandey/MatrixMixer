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
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val Red = Color(0xFFD71921)
private val Dim = Color(0xFF8A8A8A)
private val Line = Color(0xFF2A2A2A)

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
            ) { BridgeScreen() }
        }
    }
}

@Composable
private fun BridgeScreen() {
    val context = LocalContext.current
    val status by Bridge.status.collectAsStateWithLifecycle()
    val store = remember { PairingStore(context) }
    var paired by remember { mutableStateOf(store.all()) }
    // The list changes when a PC pairs, which also changes the code.
    val shownPaired = remember(status.code, paired) { store.all() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text("MATRIX BRIDGE", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = 3.sp)

        Row(verticalAlignment = Alignment.CenterVertically) {
            val (color, label) = when {
                !status.running -> Dim to "Stopped"
                status.clients.isEmpty() -> Color.White to "Waiting for your PC"
                else -> Red to "Connected: ${status.clients.joinToString()}"
            }
            Box(Modifier.size(10.dp).background(color, CircleShape))
            Spacer(Modifier.size(10.dp))
            Text(label, color = Color.White)
        }

        status.error?.let { Text(it, color = Red) }

        if (status.running) {
            Button(
                onClick = { BridgeService.stop(context) },
                colors = ButtonDefaults.buttonColors(containerColor = Line, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Stop") }
        } else {
            Button(onClick = { BridgeService.start(context) }, modifier = Modifier.fillMaxWidth()) { Text("Start") }
        }

        if (status.running) {
            Card("PAIRING CODE") {
                Text(
                    status.code.chunked(3).joinToString(" "),
                    fontFamily = FontFamily.Monospace, fontSize = 44.sp, fontWeight = FontWeight.Bold, letterSpacing = 4.sp,
                )
                Text("Type this into Matrix Bridge on your PC. It changes after each pairing.", color = Dim, fontSize = 13.sp)
            }

            Card("ADDRESS") {
                if (status.addresses.isEmpty()) {
                    Text("Not on Wi-Fi", color = Dim)
                } else {
                    status.addresses.forEach {
                        Text("$it : ${status.port}", fontFamily = FontFamily.Monospace, fontSize = 18.sp)
                    }
                }
                Text(
                    "Your PC should find this phone by itself. If it does not, type the address in. " +
                        "On networks that block device-to-device traffic, plug in USB, run " +
                        "\"adb forward tcp:${status.port} tcp:${status.port}\" on the PC and connect to 127.0.0.1.",
                    color = Dim, fontSize = 13.sp,
                )
            }
        }

        Card("GLYPH BUTTON") {
            Text(
                if (status.toyActive) "PC Remote toy is selected. Long-press the Glyph Button to trigger your PC action."
                else "To use the Glyph Button as a PC button, add the \"PC Remote\" toy, then press the Glyph Button until its arrow icon shows.",
                fontSize = 14.sp,
            )
            OutlinedButton(onClick = {
                // Nothing's own screen for adding toys to the Glyph Button carousel.
                val intent = Intent().setComponent(
                    ComponentName("com.nothing.thirdparty", "com.nothing.thirdparty.matrix.toys.manager.ToysManagerActivity"),
                )
                runCatching { context.startActivity(intent) }.onFailure {
                    Toast.makeText(context, "Open Settings > Glyph Interface > Glyph Toys instead", Toast.LENGTH_LONG).show()
                }
            }) { Text("Manage Glyph Toys") }
        }

        if (shownPaired.isNotEmpty()) {
            Card("PAIRED COMPUTERS") {
                shownPaired.forEach { (token, name) ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(name, Modifier.weight(1f))
                        TextButton(onClick = {
                            store.remove(token)
                            paired = store.all()
                            BridgeService.pairingChanged(context)
                        }) { Text("Forget", color = Red) }
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        Text("Community project. Not affiliated with or endorsed by Nothing.", color = Dim, fontSize = 12.sp)
    }
}

@Composable
private fun Card(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Line, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, color = Dim, fontSize = 12.sp, fontFamily = FontFamily.Monospace, letterSpacing = 2.sp)
        content()
    }
}
