package app.halo.mobile;

import android.os.Handler;
import android.os.Looper;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

@CapacitorPlugin(name = "HaloTdlib")
public class HaloTdlibPlugin extends Plugin {
    private static final boolean libraryAvailable;

    static {
        boolean loaded;
        try {
            System.loadLibrary("tdjson");
            System.loadLibrary("halo_tdlib");
            loaded = true;
        } catch (UnsatisfiedLinkError error) {
            loaded = false;
        }
        libraryAvailable = loaded;
    }

    private static native int nativeCreateClient();
    private static native void nativeSend(int clientId, byte[] request);
    private static native byte[] nativeReceive(double timeoutSeconds);

    private final Map<String, PluginCall> pending = new ConcurrentHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean receiving;
    private volatile int clientId;

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", libraryAvailable);
        result.put("ready", clientId != 0 && receiving);
        result.put("databaseDirectory", getContext().getFilesDir().getAbsolutePath() + "/tdlib");
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (!libraryAvailable) {
            call.reject("TDLib binaries are not installed in this Android build.");
            return;
        }
        if (clientId == 0) {
            clientId = nativeCreateClient();
            if (clientId != 0) {
                receiving = true;
                Thread receiver = new Thread(this::receiveLoop, "halo-tdlib-receiver");
                receiver.setDaemon(true);
                receiver.start();
            }
        }
        JSObject result = new JSObject();
        result.put("ready", clientId != 0);
        call.resolve(result);
    }

    @PluginMethod
    public void send(PluginCall call) {
        if (clientId == 0 || !receiving) {
            call.reject("TDLib is not started.");
            return;
        }
        JSObject request = call.getObject("request");
        if (request == null || request.optString("@type").isEmpty()) {
            call.reject("A TDLib request with @type is required.");
            return;
        }
        String token = UUID.randomUUID().toString();
        try {
            request.put("@extra", token);
            pending.put(token, call);
            nativeSend(clientId, request.toString().getBytes(StandardCharsets.UTF_8));
            handler.postDelayed(() -> {
                PluginCall expired = pending.remove(token);
                if (expired != null) expired.reject("TDLib request timed out.");
            }, 30_000);
        } catch (Exception error) {
            pending.remove(token);
            call.reject("Failed to send the TDLib request.", error);
        }
    }

    private void receiveLoop() {
        while (receiving) {
            try {
                byte[] packet = nativeReceive(1.0);
                if (packet == null) continue;
                String raw = new String(packet, StandardCharsets.UTF_8);
                JSONObject response = new JSONObject(raw);
                if (response.optInt("@client_id", clientId) != clientId) continue;
                String token = response.optString("@extra", "");
                PluginCall call = pending.remove(token);
                if (call != null) {
                    if ("error".equals(response.optString("@type"))) {
                        call.reject(response.optString("message", "TDLib error"));
                    } else {
                        JSObject result = new JSObject();
                        result.put("result", JSObject.fromJSONObject(response));
                        call.resolve(result);
                    }
                } else if (token.isEmpty()) {
                    notifyListeners("update", JSObject.fromJSONObject(response));
                }
            } catch (Exception error) {
                receiving = false;
                for (PluginCall call : pending.values()) call.reject("TDLib receive loop stopped.", error);
                pending.clear();
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        receiving = false;
        if (clientId != 0 && libraryAvailable) nativeSend(clientId, "{\"@type\":\"close\"}".getBytes(StandardCharsets.UTF_8));
        super.handleOnDestroy();
    }
}
