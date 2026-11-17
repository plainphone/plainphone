// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync.crypto

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import org.erdtman.jcs.JsonCanonicalizer
import java.io.IOException
import java.nio.ByteBuffer
import java.util.Base64

internal object WireEncoding {
    const val MAX_BUCKET = 4 * 1024 * 1024
    const val MAX_INTEGER = 9_007_199_254_740_991L
    private const val MIN_BUCKET = 256
    private val b64 = Regex("[A-Za-z0-9_-]*")
    private val integer = Regex("0|-?[1-9][0-9]*")

    fun base64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun unbase64url(value: String, length: Int? = null): ByteArray {
        require(length == null || value.length == (length * 4 + 2) / 3)
        require(b64.matches(value))
        val bytes = Base64.getUrlDecoder().decode(value)
        require(base64url(bytes) == value) { "Noncanonical base64url" }
        return bytes
    }

    fun canonical(value: JsonElement): ByteArray {
        validate(value)
        if (value.isJsonArray || value.isJsonObject) return JsonCanonicalizer(value.toString()).encodedUTF8
        // The reference serializer's decoder accepts only object or array roots.
        val wrapped = JsonCanonicalizer("[$value]").encodedUTF8
        return wrapped.copyOfRange(1, wrapped.size - 1)
    }

    fun parseCanonical(bytes: ByteArray): JsonElement = try {
        val text = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()
        val value = JsonReader(text.reader()).use { reader ->
            reader.strictness = Strictness.STRICT
            val result = readJson(reader)
            require(reader.peek() == JsonToken.END_DOCUMENT)
            result
        }
        require(canonical(value).contentEquals(bytes)) { "Noncanonical JSON" }
        value
    } catch (e: IOException) {
        throw IllegalArgumentException("Invalid UTF-8 or JSON", e)
    }

    private fun readJson(reader: JsonReader): JsonElement = when (reader.peek()) {
        JsonToken.BEGIN_OBJECT -> JsonObject().apply {
            reader.beginObject()
            while (reader.hasNext()) {
                val name = reader.nextName()
                require(!has(name)) { "Duplicate JSON member" }
                add(name, readJson(reader))
            }
            reader.endObject()
        }
        JsonToken.BEGIN_ARRAY -> JsonArray().apply {
            reader.beginArray()
            while (reader.hasNext()) add(readJson(reader))
            reader.endArray()
        }
        JsonToken.NUMBER -> JsonPrimitive(parseInteger(reader.nextString()))
        JsonToken.STRING -> JsonPrimitive(reader.nextString())
        JsonToken.BOOLEAN -> JsonPrimitive(reader.nextBoolean())
        JsonToken.NULL -> {
            reader.nextNull()
            JsonNull.INSTANCE
        }
        else -> throw IllegalArgumentException("Invalid JSON token")
    }

    private fun validate(value: JsonElement) {
        when {
            value.isJsonObject -> value.asJsonObject.entrySet().forEach { (name, child) ->
                validateString(name)
                validate(child)
            }
            value.isJsonArray -> value.asJsonArray.forEach(::validate)
            value.isJsonPrimitive -> value.asJsonPrimitive.let {
                if (it.isNumber) parseInteger(it.asString)
                if (it.isString) validateString(it.asString)
            }
        }
    }

    fun parseInteger(value: String): Long {
        require(integer.matches(value)) { "Expected a safe integer" }
        return value.toLong().also { require(it in -MAX_INTEGER..MAX_INTEGER) }
    }

    private fun validateString(value: String) {
        var index = 0
        while (index < value.length) {
            val char = value[index++]
            if (char.isHighSurrogate()) require(index < value.length && value[index++].isLowSurrogate())
            else require(!char.isLowSurrogate())
        }
    }

    fun pad(body: JsonElement): ByteArray {
        val payload = canonical(body)
        return ByteBuffer.allocate(bucket(payload.size)).putInt(payload.size).put(payload).array()
    }

    fun unpad(bytes: ByteArray): JsonElement {
        require(bytes.size in MIN_BUCKET..MAX_BUCKET)
        val length = ByteBuffer.wrap(bytes).int
        require(bucket(length) == bytes.size)
        require((4 + length until bytes.size).all { bytes[it] == 0.toByte() }) { "Invalid padding" }
        return parseCanonical(bytes.copyOfRange(4, 4 + length))
    }

    private fun bucket(length: Int): Int {
        require(length in 1..MAX_BUCKET - 4)
        return maxOf(MIN_BUCKET, Integer.highestOneBit(length + 3) shl 1)
    }
}
