// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

/**
 * The text field after the child taps "Write it again" on a message that did not go through.
 * An empty field gets the old text back; text the child has already started is kept, with the
 * old text on a new line below it, so nothing is lost either way.
 */
internal fun draftAfterRetry(draft: String, failedBody: String): String =
    if (draft.isBlank()) failedBody else draft.trimEnd() + "\n" + failedBody
