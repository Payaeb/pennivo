package app.pennivo.editor;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareIntentPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // When the activity is already running and Android delivers a new intent
        // (e.g. user shares a .md file while Pennivo is in the background),
        // update getIntent() so ShareIntentPlugin can read the new payload.
        setIntent(intent);
    }
}
