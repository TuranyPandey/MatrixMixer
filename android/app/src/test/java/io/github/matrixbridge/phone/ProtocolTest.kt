package io.github.matrixbridge.phone

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {

    private fun frame(fill: (Int) -> Any) =
        JSONObject().put("t", "frame").put("px", JSONArray((0 until Protocol.PIXELS).map(fill))).toString()

    @Test
    fun `reads a full frame`() {
        val msg = Protocol.parse(frame { it % 256 }) as Protocol.PcMessage.Frame
        assertArrayEquals(IntArray(Protocol.PIXELS) { it % 256 }, msg.px)
    }

    @Test
    fun `rejects frames of the wrong size or range`() {
        assertNull(Protocol.parse("""{"t":"frame","px":[1,2,3]}"""))
        assertNull(Protocol.parse(frame { 256 }))
        assertNull(Protocol.parse(frame { -1 }))
        assertNull(Protocol.parse(frame { 1.5 }))
        assertNull(Protocol.parse(frame { "9" }))
    }

    private fun store(frames: Int, delay: Any, fill: Any = 7) = JSONObject()
        .put("t", "store").put("name", "Wave").put("delay", delay)
        .put("frames", JSONArray((0 until frames).map { JSONArray((0 until Protocol.PIXELS).map { fill }) }))
        .toString()

    @Test
    fun `reads a glyph to keep`() {
        val msg = Protocol.parse(store(3, 200)) as Protocol.PcMessage.Store
        assertEquals("Wave", msg.name)
        assertEquals(3, msg.frames.size)
        assertEquals(200, msg.delayMs)
        assertArrayEquals(IntArray(Protocol.PIXELS) { 7 }, msg.frames[2])
    }

    @Test
    fun `rejects glyphs with no frames, too many, a bad frame or a bad delay`() {
        assertNull(Protocol.parse(store(0, 200)))
        assertNull(Protocol.parse(store(Protocol.MAX_STORED_FRAMES + 1, 200)))
        assertNull(Protocol.parse(store(2, 200, fill = 300)))
        assertNull(Protocol.parse(store(2, 20)))
        assertNull(Protocol.parse(store(2, 5000)))
        assertNull(Protocol.parse(store(2, "200")))
    }

    @Test
    fun `battery and stored are well formed`() {
        val battery = JSONObject(Protocol.battery(140, true))
        assertEquals("battery", battery.getString("t"))
        assertEquals(100, battery.getInt("level"))
        assertTrue(battery.getBoolean("charging"))
        assertEquals("Wave", JSONObject(Protocol.stored("Wave")).getString("name"))
    }

    @Test
    fun `rejects anything that is not a known message`() {
        assertNull(Protocol.parse("garbage"))
        assertNull(Protocol.parse("[]"))
        assertNull(Protocol.parse("""{"t":"reboot"}"""))
        assertNull(Protocol.parse("""{"no":"type"}"""))
    }

    @Test
    fun `pairing codes must be six digits in a string`() {
        assertEquals(Protocol.PcMessage.Pair("123456", "Laptop"), Protocol.parse("""{"t":"pair","code":"123456","name":"Laptop"}"""))
        assertNull(Protocol.parse("""{"t":"pair","code":"12345","name":"Laptop"}"""))
        assertNull(Protocol.parse("""{"t":"pair","code":123456,"name":"Laptop"}"""))
        assertNull(Protocol.parse("""{"t":"pair","code":"12345a"}"""))
    }

    @Test
    fun `brightness is a byte`() {
        assertEquals(Protocol.PcMessage.Brightness(0), Protocol.parse("""{"t":"brightness","value":0}"""))
        assertEquals(Protocol.PcMessage.Brightness(255), Protocol.parse("""{"t":"brightness","value":255}"""))
        assertNull(Protocol.parse("""{"t":"brightness","value":256}"""))
        assertNull(Protocol.parse("""{"t":"brightness"}"""))
    }

    @Test
    fun `auth needs a token`() {
        assertEquals(Protocol.PcMessage.Auth("abc", null), Protocol.parse("""{"t":"auth","token":"abc"}"""))
        assertNull(Protocol.parse("""{"t":"auth","token":""}"""))
        assertNull(Protocol.parse("""{"t":"auth"}"""))
    }

    @Test
    fun `outgoing messages are what the PC expects`() {
        val hello = JSONObject(Protocol.hello("Phone (3)"))
        assertEquals("hello", hello.getString("t"))
        assertEquals(Protocol.VERSION, hello.getInt("v"))
        assertEquals(25, hello.getInt("size"))
        assertEquals("long", JSONObject(Protocol.buttonEvent("long")).getString("action"))
        assertTrue(JSONObject(Protocol.status(true)).getBoolean("toy"))
        assertEquals("bad_code", JSONObject(Protocol.error("bad_code", "x")).getString("code"))
    }
}
