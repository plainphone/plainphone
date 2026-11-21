// SPDX-License-Identifier: Apache-2.0
package org.plainphone.fixture;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;

public final class PlayerActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(R.string.enter_pip);
        button.setOnClickListener(view -> {
            Rect source = new Rect();
            view.getGlobalVisibleRect(source);
            PictureInPictureParams.Builder params = new PictureInPictureParams.Builder()
                    .setSourceRectHint(source);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                params.setAutoEnterEnabled(true);
            }
            enterPictureInPictureMode(params.build());
        });
        setContentView(button);
    }
}
