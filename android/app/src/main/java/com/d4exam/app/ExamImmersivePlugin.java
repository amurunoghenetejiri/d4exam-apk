package com.d4exam.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

/**
 * Immersive CBT chrome + reliable native vibration.
 * WebView navigator.vibrate is unreliable and can cancel the motor — always use this plugin.
 */
@CapacitorPlugin(name = "ExamImmersive")
public class ExamImmersivePlugin extends Plugin {

  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  @PluginMethod
  public void enter(PluginCall call) {
    getActivity().runOnUiThread(() -> {
      try {
        Window window = getActivity().getWindow();
        View decor = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          WindowInsetsControllerCompat c = WindowCompat.getInsetsController(window, decor);
          if (c != null) {
            c.hide(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
            c.setSystemBarsBehavior(
              WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
          }
        } else {
          //noinspection deprecation
          decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
              | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN
          );
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
      } catch (Exception ignored) {
      }
      call.resolve();
    });
  }

  @PluginMethod
  public void exit(PluginCall call) {
    getActivity().runOnUiThread(() -> {
      try {
        Window window = getActivity().getWindow();
        View decor = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          WindowInsetsControllerCompat c = WindowCompat.getInsetsController(window, decor);
          if (c != null) {
            c.show(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
          }
        } else {
          //noinspection deprecation
          decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
      } catch (Exception ignored) {
      }
      call.resolve();
    });
  }

  /**
   * Native motor vibration — pattern is ms alternating delay/on (same as navigator.vibrate).
   * Always runs on the main thread so OEM vibrator services accept the call.
   */
  @PluginMethod
  public void vibrate(PluginCall call) {
    final long[] pattern = parsePattern(call);
    mainHandler.post(() -> {
      try {
        Vibrator vibrator = resolveVibrator();
        if (vibrator == null) {
          JSObject ret = new JSObject();
          ret.put("ok", false);
          ret.put("error", "no_vibrator");
          call.resolve(ret);
          return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          try {
            if (!vibrator.hasVibrator()) {
              JSObject ret = new JSObject();
              ret.put("ok", false);
              ret.put("error", "has_vibrator_false");
              call.resolve(ret);
              return;
            }
          } catch (Exception ignored) {
          }
        }

        try {
          vibrator.cancel();
        } catch (Exception ignored) {
        }

        long[] p = pattern;
        if (p == null || p.length == 0) {
          p = new long[] { 0, 220 };
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          try {
            int[] amps = new int[p.length];
            for (int i = 0; i < p.length; i++) {
              amps[i] = (i % 2 == 1) ? 255 : 0;
            }
            if (p.length >= 2 && p[0] == 0) {
              vibrator.vibrate(VibrationEffect.createWaveform(p, amps, -1));
            } else {
              vibrator.vibrate(VibrationEffect.createWaveform(p, -1));
            }
          } catch (Exception e) {
            try {
              long total = 0;
              for (long x : p) total += x;
              long ms = Math.max(80, Math.min(total > 0 ? total : 220, 1200));
              vibrator.vibrate(
                VibrationEffect.createOneShot(ms, 255)
              );
            } catch (Exception e2) {
              //noinspection deprecation
              vibrator.vibrate(p, -1);
            }
          }
        } else {
          //noinspection deprecation
          vibrator.vibrate(p, -1);
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
      } catch (Exception e) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("error", e.getMessage() != null ? e.getMessage() : "vibrate_failed");
        call.resolve(ret);
      }
    });
  }

  private Vibrator resolveVibrator() {
    Context ctx = getContext();
    if (ctx == null) {
      try {
        ctx = getActivity();
      } catch (Exception ignored) {
      }
    }
    if (ctx == null) return null;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        VibratorManager vm =
          (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        if (vm != null) {
          Vibrator v = vm.getDefaultVibrator();
          if (v != null) return v;
        }
      } catch (Exception ignored) {
      }
    }
    //noinspection deprecation
    return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
  }

  private long[] parsePattern(PluginCall call) {
    try {
      JSONArray arr = call.getArray("pattern");
      if (arr != null && arr.length() > 0) {
        long[] out = new long[arr.length()];
        for (int i = 0; i < arr.length(); i++) {
          double d = arr.optDouble(i, Double.NaN);
          if (Double.isNaN(d)) {
            out[i] = Math.max(0, arr.optLong(i, 0));
          } else {
            out[i] = Math.max(0, Math.round(d));
          }
        }
        return out;
      }
    } catch (Exception ignored) {
    }
    try {
      Integer ms = call.getInt("ms");
      if (ms != null && ms > 0) {
        return new long[] { 0, ms.longValue() };
      }
    } catch (Exception ignored) {
    }
    return new long[] { 0, 220 };
  }
}
