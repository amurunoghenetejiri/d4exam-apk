package com.d4exam.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground service required while MediaProjection is active (Android 10+ / API 34+).
 * MUST call startForeground(..., FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) successfully
 * BEFORE MediaProjectionManager.getMediaProjection(). Untyped startForeground is NOT enough.
 */
public class ScreenCaptureService extends Service {
  private static final String TAG = "D4ScreenCaptureSvc";
  private static final String CHANNEL_ID = "d4exam_screen_share";
  private static final int NOTIF_ID = 4402;
  private static final int NOTIF_COLOR = 0xFF0B1B3A;

  public static final AtomicBoolean FOREGROUND_READY = new AtomicBoolean(false);
  public static volatile CountDownLatch READY_LATCH = new CountDownLatch(1);

  public static void resetReady() {
    FOREGROUND_READY.set(false);
    READY_LATCH = new CountDownLatch(1);
  }

  @Override
  public void onCreate() {
    super.onCreate();
    promoteToForeground();
  }

  private int resolveSmallIcon() {
    try {
      int resId = getResources().getIdentifier("ic_stat_d4exam", "drawable", getPackageName());
      if (resId != 0) return resId;
    } catch (Exception ignored) {}
    try {
      int resId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
      if (resId != 0) return resId;
    } catch (Exception ignored) {}
    return android.R.drawable.ic_menu_camera;
  }

  private void promoteToForeground() {
    createChannel();
    int smallIcon = resolveSmallIcon();

    NotificationCompat.Builder builder =
        new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("D4EXAM")
            .setContentText("Screen monitoring is active during your exam.")
            .setSmallIcon(smallIcon)
            .setColor(NOTIF_COLOR)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

    if (Build.VERSION.SDK_INT >= 31) {
      try {
        builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
      } catch (Exception ignored) {}
    }

    Notification notification = builder.build();
    boolean ok = false;

    try {
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(
            NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        ok = true;
        Log.i(TAG, "startForeground MEDIA_PROJECTION ok");
      } else {
        startForeground(NOTIF_ID, notification);
        ok = true;
      }
    } catch (Exception e) {
      Log.e(TAG, "startForeground MEDIA_PROJECTION failed", e);
      try {
        Notification fallback =
            new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("D4EXAM")
                .setContentText("Screen monitoring active")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setSilent(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
          startForeground(
              NOTIF_ID, fallback, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
          startForeground(NOTIF_ID, fallback);
        }
        ok = true;
        Log.i(TAG, "startForeground MEDIA_PROJECTION retry ok");
      } catch (Exception e2) {
        Log.e(TAG, "typed FGS retry failed", e2);
        try {
          startForeground(NOTIF_ID, notification);
          Log.w(TAG, "untyped startForeground fallback (MediaProjection may fail)");
        } catch (Exception e3) {
          Log.e(TAG, "all startForeground attempts failed", e3);
        }
        ok = false;
      }
    }

    FOREGROUND_READY.set(ok);
    try {
      READY_LATCH.countDown();
    } catch (Exception ignored) {}
    Log.i(TAG, "FOREGROUND_READY=" + ok + " api=" + Build.VERSION.SDK_INT);
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel =
          new NotificationChannel(
              CHANNEL_ID, "Exam screen monitoring", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Shown while screen share is active during an examination");
      channel.setShowBadge(false);
      channel.setSound(null, null);
      channel.enableVibration(false);
      NotificationManager nm = getSystemService(NotificationManager.class);
      if (nm != null) nm.createNotificationChannel(channel);
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (!FOREGROUND_READY.get()) {
      promoteToForeground();
    }
    return START_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public void onDestroy() {
    FOREGROUND_READY.set(false);
    Log.i(TAG, "onDestroy");
    super.onDestroy();
  }
}
