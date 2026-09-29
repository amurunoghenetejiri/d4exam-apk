package com.d4exam.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native VoIP helpers for D4EXAM:
 * - Default system ringtone + vibration for incoming calls
 * - Full-screen incoming-call notification
 * - Active-call foreground service (separate from exam screen-share)
 */
@CapacitorPlugin(name = "D4Call")
public class D4CallPlugin extends Plugin {
  public static final String INCOMING_CHANNEL = "d4exam_incoming_call";
  public static final int INCOMING_NOTIF_ID = 7402;

  private Ringtone ringtone;
  private Vibrator vibrator;
  private boolean ringing = false;

  @PluginMethod
  public void startIncomingRing(PluginCall call) {
    Context ctx = getContext();
    ensureIncomingChannel(ctx);
    stopRingInternal();

    try {
      Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
      if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
      ringtone = RingtoneManager.getRingtone(ctx, uri);
      if (ringtone != null) {
        if (Build.VERSION.SDK_INT >= 28) {
          ringtone.setLooping(true);
        }
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        try {
          ringtone.setAudioAttributes(attrs);
        } catch (Throwable ignored) {}
        // Respect silent / DND: only play if ringer mode allows
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null || am.getRingerMode() != AudioManager.RINGER_MODE_SILENT) {
          if (am == null || am.getRingerMode() == AudioManager.RINGER_MODE_NORMAL) {
            ringtone.play();
          }
        }
      }
    } catch (Throwable t) {
      // ignore
    }

    try {
      if (Build.VERSION.SDK_INT >= 31) {
        VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        vibrator = vm != null ? vm.getDefaultVibrator() : null;
      } else {
        vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
      }
      AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
      boolean canVibrate = am == null || am.getRingerMode() != AudioManager.RINGER_MODE_SILENT;
      if (vibrator != null && canVibrate) {
        long[] pattern = new long[] {0, 800, 400, 800, 400};
        if (Build.VERSION.SDK_INT >= 26) {
          vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
          vibrator.vibrate(pattern, 0);
        }
      }
    } catch (Throwable t) {
      // ignore
    }

    ringing = true;
    call.resolve();
  }

  @PluginMethod
  public void stopIncomingRing(PluginCall call) {
    stopRingInternal();
    try {
      NotificationManagerCompat.from(getContext()).cancel(INCOMING_NOTIF_ID);
    } catch (Throwable ignored) {}
    call.resolve();
  }

  @PluginMethod
  public void showIncomingCallNotification(PluginCall call) {
    Context ctx = getContext();
    ensureIncomingChannel(ctx);

    String callId = call.getString("callId", "");
    String name = call.getString("callerName", "D4EXAM Call");
    String subtitle = call.getString("subtitle", "Incoming call");
    String callType = call.getString("callType", "voice");
    boolean video = "video".equalsIgnoreCase(callType);

    Intent open = new Intent(ctx, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    open.putExtra("d4_call_action", "incoming");
    open.putExtra("d4_call_id", callId);
    open.putExtra("d4_call_type", callType);
    PendingIntent contentPi = PendingIntent.getActivity(
        ctx, 10, open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent answerI = new Intent(ctx, MainActivity.class);
    answerI.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    answerI.putExtra("d4_call_action", "answer");
    answerI.putExtra("d4_call_id", callId);
    answerI.putExtra("d4_call_type", callType);
    PendingIntent answerPi = PendingIntent.getActivity(
        ctx, 11, answerI,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent declineI = new Intent(ctx, MainActivity.class);
    declineI.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    declineI.putExtra("d4_call_action", "decline");
    declineI.putExtra("d4_call_id", callId);
    PendingIntent declinePi = PendingIntent.getActivity(
        ctx, 12, declineI,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    int icon = ctx.getResources().getIdentifier("ic_stat_d4exam", "drawable", ctx.getPackageName());
    if (icon == 0) icon = android.R.drawable.sym_call_incoming;

    NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, INCOMING_CHANNEL)
        .setContentTitle(name)
        .setContentText(subtitle)
        .setSmallIcon(icon)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setOngoing(true)
        .setAutoCancel(false)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(contentPi)
        .setFullScreenIntent(contentPi, true)
        .addAction(0, "Decline", declinePi)
        .addAction(0, video ? "Answer video" : "Answer", answerPi)
        .setTimeoutAfter(60_000);

    try {
      NotificationManagerCompat.from(ctx).notify(INCOMING_NOTIF_ID, b.build());
    } catch (SecurityException se) {
      call.reject("Notification permission required");
      return;
    }
    call.resolve();
  }

  @PluginMethod
  public void startActiveCallService(PluginCall call) {
    Context ctx = getContext();
    Intent i = new Intent(ctx, CallForegroundService.class);
    i.putExtra(CallForegroundService.EXTRA_TITLE, call.getString("title", "D4EXAM Call"));
    i.putExtra(CallForegroundService.EXTRA_SUBTITLE, call.getString("subtitle", "Tap to return"));
    if (Build.VERSION.SDK_INT >= 26) {
      ctx.startForegroundService(i);
    } else {
      ctx.startService(i);
    }
    call.resolve();
  }

  @PluginMethod
  public void stopActiveCallService(PluginCall call) {
    Context ctx = getContext();
    Intent i = new Intent(ctx, CallForegroundService.class);
    i.setAction(CallForegroundService.ACTION_END);
    ctx.startService(i);
    ctx.stopService(new Intent(ctx, CallForegroundService.class));
    call.resolve();
  }

  @PluginMethod
  public void setSpeakerphone(PluginCall call) {
    Boolean on = call.getBoolean("on", true);
    try {
      AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
      if (am != null) {
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        am.setSpeakerphoneOn(Boolean.TRUE.equals(on));
      }
      call.resolve();
    } catch (Throwable t) {
      call.reject(t.getMessage());
    }
  }

  private void stopRingInternal() {
    ringing = false;
    try {
      if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
    } catch (Throwable ignored) {}
    ringtone = null;
    try {
      if (vibrator != null) vibrator.cancel();
    } catch (Throwable ignored) {}
  }

  private void ensureIncomingChannel(Context ctx) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(
        INCOMING_CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("Incoming D4EXAM voice and video calls");
    ch.enableVibration(true);
    ch.setBypassDnd(false);
    Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    if (ring != null) {
      ch.setSound(ring, new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build());
    }
    nm.createNotificationChannel(ch);
  }

  @Override
  protected void handleOnDestroy() {
    stopRingInternal();
    super.handleOnDestroy();
  }
}
