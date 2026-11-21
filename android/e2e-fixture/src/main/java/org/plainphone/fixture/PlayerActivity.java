// SPDX-License-Identifier: Apache-2.0
package org.plainphone.fixture;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.os.Bundle;
import android.widget.Button;

public final class PlayerActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(R.string.enter_pip);
        button.setOnClickListener(view ->
                enterPictureInPictureMode(new PictureInPictureParams.Builder().build()));
        setContentView(button);
    }
}
