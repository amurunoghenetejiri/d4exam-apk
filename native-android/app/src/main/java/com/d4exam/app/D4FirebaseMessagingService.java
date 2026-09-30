package com.d4exam.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class D4FirebaseMessagingService extends FirebaseMessagingService {
  public static final String CALL_CHANNEL_ID = "d4exam_incoming_call_wake";
  public static final String MSG_CHANNEL_ID = "d4exam_messages";
  public static final int CALL_NOTIF_ID = 7403;

  @Override
  public void onNewToken(@NonNull String token) {
    super.onNewToken(token);
  }

  @Override
  public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
    super.onMessageReceived(remoteMessage);
    Map<String, String> data = remoteMessage.getData();
    String type = data != null ? data.get("type") : null;
    if ("incoming_call".equalsIgnoreCase(type)) {
      handleIncomingCallWake(data);
    } else {
      handleGeneralPush(remoteMessage);
    }
  }

  private void handleIncomingCallWake(Map<String, String> data) {
    String callId = data.get("callId");
    String callerName = data.get("callerName");
    String callType = data.get("callType");
    if (callerName == null || callerName.isEmpty()) callerName = "Incoming Call";
    if (callType == null) callType = "voice";

    createCallChannel();

    Intent fullScreenIntent = new Intent(this, MainActivity.class);
    fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    fullScreenIntent.putExtra("d4_call_action", "incoming");
    fullScreenIntent.putExtra("d4_call_id", callId);
    fullScreenIntent.putExtra("d4_call_type", callType);

    PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
        this, 100, fullScreenIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Intent answerIntent = new Intent(this, MainActivity.class);
    answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    answerIntent.putExtra("d4_call_action", "answer");
    answerIntent.putExtra("d4_call_id", callId);
    answerIntent.putExtra("d4_call_type", callType);

    PendingIntent answerPendingIntent = PendingIntent.getActivity(
        this, 101, answerIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    int icon = getResources().getIdentifier("ic_stat_d4exam", "drawable", getPackageName());
    if (icon == 0) icon = android.R.drawable.sym_call_incoming;

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(callerName)
        .setContentText("Incoming " + callType + " call...")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setAutoCancel(true)
        .setOngoing(true)
        .setVibrate(new long[] {0, 800, 400, 800, 400})
        // Sound handled by D4CallPlugin ringtone when app processes the call
        // .setSound(ringUri)
        .setFullScreenIntent(fullScreenPendingIntent, true)
        .setContentIntent(fullScreenPendingIntent)
        .addAction(android.R.drawable.ic_menu_call, "Accept", answerPendingIntent)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

    try {
      NotificationManagerCompat.from(this).notify(CALL_NOTIF_ID, builder.build());
    } catch (SecurityException ignored) {}
  }

  private void handleGeneralPush(RemoteMessage remoteMessage) {
    createMsgChannel();

    String title = "D4EXAM Notification";
    String body = "You have a new update";
    if (remoteMessage.getNotification() != null) {
      if (remoteMessage.getNotification().getTitle() != null) title = remoteMessage.getNotification().getTitle();
      if (remoteMessage.getNotification().getBody() != null) body = remoteMessage.getNotification().getBody();
    } else if (remoteMessage.getData() != null) {
      if (remoteMessage.getData().get("title") != null) title = remoteMessage.getData().get("title");
      if (remoteMessage.getData().get("message") != null) body = remoteMessage.getData().get("message");
      else if (remoteMessage.getData().get("body") != null) body = remoteMessage.getData().get("body");
    }

    Intent openIntent = new Intent(this, MainActivity.class);
    openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent pi = PendingIntent.getActivity(
        this, 200, openIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    int icon = getResources().getIdentifier("ic_stat_d4exam", "drawable", getPackageName());
    if (icon == 0) icon = android.R.drawable.ic_dialog_info;

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MSG_CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(pi);

    try {
      NotificationManagerCompat.from(this).notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), builder.build());
    } catch (SecurityException ignored) {}
  }

  private void createCallChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) {
        NotificationChannel ch = new NotificationChannel(
            CALL_CHANNEL_ID, "Incoming Calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Rings when someone calls your D4EXAM account");
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .build();
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), attrs);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 800, 400, 800, 400});
        nm.createNotificationChannel(ch);
      }
    }
  }

  private void createMsgChannel() {
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) {
        NotificationChannel ch = new NotificationChannel(
            MSG_CHANNEL_ID, "Messages & Updates", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Direct messages and academic notices");
        nm.createNotificationChannel(ch);
      }
    }
  }
}
