package com.d4exam.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class CallForegroundService extends Service {
  public static final String CHANNEL_ID = "d4exam_active_call";
  public static final int NOTIF_ID = 7401;
  public static final String ACTION_RETURN = "com.d4exam.app.CALL_RETURN";
  public static final String ACTION_END = "com.d4exam.app.CALL_END";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_SUBTITLE = "subtitle";

  private PowerManager.WakeLock wakeLock;

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannel();
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm != null) {
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "d4exam:call_keepalive");
        wakeLock.acquire(4L * 60L * 60L * 1000L); // Max 4 hours
      }
    } catch (Throwable ignored) {}
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_END.equals(intent.getAction())) {
      stopSelf();
      return START_NOT_STICKY;
    }
    String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : "D4EXAM Call";
    String subtitle = intent != null ? intent.getStringExtra(EXTRA_SUBTITLE) : "In call · Tap to return";
    if (title == null || title.isEmpty()) title = "D4EXAM Call";
    if (subtitle == null) subtitle = "In call · Tap to return";

    Intent open = new Intent(this, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    open.putExtra("d4_call_action", "return");
    PendingIntent pi = PendingIntent.getActivity(
        this, 0, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent endI = new Intent(this, CallForegroundService.class);
    endI.setAction(ACTION_END);
    PendingIntent endPi = PendingIntent.getService(
        this, 1, endI,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    int icon = getResources().getIdentifier("ic_stat_d4exam", "drawable", getPackageName());
    if (icon == 0) icon = android.R.drawable.ic_menu_call;

    NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(subtitle)
        .setSmallIcon(icon)
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setContentIntent(pi)
        .addAction(0, "Return", pi)
        .addAction(0, "End Call", endPi)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

    Notification n = b.build();
    if (Build.VERSION.SDK_INT >= 34) {
      try {
        startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            | ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
      } catch (Throwable t) {
        startForeground(NOTIF_ID, n);
      }
    } else if (Build.VERSION.SDK_INT >= 29) {
      try {
        startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
      } catch (Throwable t) {
        startForeground(NOTIF_ID, n);
      }
    } else {
      startForeground(NOTIF_ID, n);
    }
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    try {
      if (wakeLock != null && wakeLock.isHeld()) {
        wakeLock.release();
      }
    } catch (Throwable ignored) {}
    stopForeground(true);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(
        CHANNEL_ID, "Active Calls", NotificationManager.IMPORTANCE_LOW);
    ch.setDescription("Ongoing D4EXAM voice and video calls");
    ch.setSound(null, null);
    nm.createNotificationChannel(ch);
  }
}
