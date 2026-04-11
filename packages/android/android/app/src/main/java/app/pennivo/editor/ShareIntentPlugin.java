package app.pennivo.editor;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;

@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

    @PluginMethod()
    public void getSharedContent(PluginCall call) {
        Intent intent = getActivity().getIntent();
        if (intent == null) {
            call.resolve(buildEmpty());
            return;
        }

        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null) {
            handleSendIntent(call, intent, type);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            handleViewIntent(call, intent);
        } else {
            call.resolve(buildEmpty());
        }
    }

    @PluginMethod()
    public void clearIntent(PluginCall call) {
        Intent intent = getActivity().getIntent();
        if (intent != null) {
            intent.setAction(null);
            intent.setData(null);
            intent.removeExtra(Intent.EXTRA_STREAM);
            intent.removeExtra(Intent.EXTRA_TEXT);
        }
        call.resolve();
    }

    private void handleSendIntent(PluginCall call, Intent intent, String type) {
        // Try EXTRA_STREAM first (file URI)
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) {
            String content = readContentFromUri(uri);
            if (content != null) {
                String fileName = getFileNameFromUri(uri);
                JSObject result = new JSObject();
                result.put("hasContent", true);
                result.put("content", content);
                result.put("fileName", fileName != null ? fileName : "shared.md");
                result.put("source", "send_stream");
                call.resolve(result);
                return;
            }
        }

        // Fall back to EXTRA_TEXT (plain text share)
        if (type.startsWith("text/")) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                JSObject result = new JSObject();
                result.put("hasContent", true);
                result.put("content", text);
                result.put("fileName", "shared.md");
                result.put("source", "send_text");
                call.resolve(result);
                return;
            }
        }

        call.resolve(buildEmpty());
    }

    private void handleViewIntent(PluginCall call, Intent intent) {
        Uri uri = intent.getData();
        if (uri == null) {
            call.resolve(buildEmpty());
            return;
        }

        String content = readContentFromUri(uri);
        if (content != null) {
            String fileName = getFileNameFromUri(uri);
            JSObject result = new JSObject();
            result.put("hasContent", true);
            result.put("content", content);
            result.put("fileName", fileName != null ? fileName : "shared.md");
            result.put("source", "view");
            call.resolve(result);
        } else {
            call.resolve(buildEmpty());
        }
    }

    private String readContentFromUri(Uri uri) {
        try {
            InputStream inputStream = getContext().getContentResolver().openInputStream(uri);
            if (inputStream == null) return null;

            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
            reader.close();
            inputStream.close();

            // Remove trailing newline
            if (sb.length() > 0 && sb.charAt(sb.length() - 1) == '\n') {
                sb.setLength(sb.length() - 1);
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private String getFileNameFromUri(Uri uri) {
        String path = uri.getLastPathSegment();
        if (path != null) {
            // Handle content:// URIs that encode the path
            int slash = path.lastIndexOf('/');
            if (slash >= 0) {
                path = path.substring(slash + 1);
            }
            // Ensure .md extension
            if (!path.endsWith(".md") && !path.endsWith(".markdown")) {
                path = path + ".md";
            }
            return path;
        }
        return null;
    }

    private JSObject buildEmpty() {
        JSObject result = new JSObject();
        result.put("hasContent", false);
        result.put("content", "");
        result.put("fileName", "");
        result.put("source", "none");
        return result;
    }
}
