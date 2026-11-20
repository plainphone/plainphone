// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.sync.AgreementRules

/** "Our family agreement" on "What can my parents see?": the family's words, and the adults' lines (docs/family-agreement.md). */
@Composable
fun AgreementSection(agreement: AgreementRules) {
    if (agreement.isEmpty) return
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column {
        if (agreement.lines.isNotEmpty()) {
            Text(
                stringResource(R.string.agreement_title),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() }.padding(top = 8.dp, bottom = 4.dp),
            )
            agreement.lines.forEach { Text(it, fontSize = 16.sp, modifier = Modifier.padding(vertical = 2.dp)) }
        }
        if (agreement.adultLines.isNotEmpty()) {
            Text(
                stringResource(R.string.agreement_adults_title),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() }.padding(top = 12.dp, bottom = 4.dp),
            )
            agreement.adultLines.forEach { Text(it, fontSize = 16.sp, modifier = Modifier.padding(vertical = 2.dp)) }
            Text(stringResource(R.string.agreement_adults_hint), fontSize = 14.sp, color = muted, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
