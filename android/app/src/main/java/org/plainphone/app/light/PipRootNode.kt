// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.os.Build
import android.os.Parcel
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The node through which Android 10 to 13 let an accessibility service close a picture-in-picture
 * window. Android hands every action on a pinned window to System UI, and System UI acts only on
 * the node id `AccessibilityNodeInfo.ROOT_NODE_ID` (AOSP 10: AccessibilityManagerService
 * .performAccessibilityAction, PipAccessibilityInteractionConnection). No app or menu window ever
 * reports that id, so a dismiss on a window's own root is refused, and there is no public way to
 * name the id. The node is therefore built from its parcel, whose leading fields (sealed, source
 * id, window id, four node links, connection id) are the same from Android 10 to 13; Android 14
 * changed them, and needs none of this.
 */
object PipRootNode {
    /** `makeNodeId(ROOT_ITEM_ID, HOST_VIEW_ID)`: the view id `Int.MAX_VALUE - 1`, no virtual child. */
    const val ROOT_NODE_ID = (-1L shl 32) or (Int.MAX_VALUE - 1).toLong()

    val supported: Boolean get() = Build.VERSION.SDK_INT in Build.VERSION_CODES.Q..Build.VERSION_CODES.TIRAMISU

    private const val SEALED = 0
    private const val SOURCE = 1
    private const val WINDOW = 2
    private const val CONNECTION = 8

    /**
     * The accessibility connection a node from this service was read over, or null when its parcel
     * does not have the expected layout. Android 10 recycles a node it writes to a parcel, so
     * [template] must not be used afterwards.
     */
    fun connectionId(template: AccessibilityNodeInfo): Int? {
        val windowId = template.windowId
        val parcel = Parcel.obtain()
        return try {
            template.writeToParcel(parcel, 0)
            parcel.setDataPosition(0)
            val fields = parcel.readLong()
            if (!fields.has(SEALED) || parcel.readInt() != 1) return null
            if (fields.has(SOURCE)) parcel.readLong()
            if ((if (fields.has(WINDOW)) parcel.readInt() else -1) != windowId) return null
            for (link in WINDOW + 1 until CONNECTION) if (fields.has(link)) parcel.readLong()
            if (fields.has(CONNECTION)) parcel.readInt() else null
        } catch (e: RuntimeException) {
            null
        } finally {
            parcel.recycle()
        }
    }

    /** System UI's root node of the pinned window [windowId], for the service's [connectionId]. */
    fun of(windowId: Int, connectionId: Int): AccessibilityNodeInfo? {
        val parcel = Parcel.obtain()
        return try {
            parcel.writeLong(bit(SEALED) or bit(SOURCE) or bit(WINDOW) or bit(CONNECTION))
            parcel.writeInt(1)
            parcel.writeLong(ROOT_NODE_ID)
            parcel.writeInt(windowId)
            parcel.writeInt(connectionId)
            parcel.setDataPosition(0)
            AccessibilityNodeInfo.CREATOR.createFromParcel(parcel)
                .takeIf { it.windowId == windowId }
        } catch (e: RuntimeException) {
            null
        } finally {
            parcel.recycle()
        }
    }

    private fun bit(field: Int) = 1L shl field
    private fun Long.has(field: Int) = this and bit(field) != 0L
}
