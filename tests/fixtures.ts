const encoder = new TextEncoder();

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function pngBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(PNG_1X1, 'base64'));
}

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

/** A small but realistic apktool output with two activities and click handlers. */
export function demoProject(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  files.set(
    'AndroidManifest.xml',
    text(`<?xml version="1.0" encoding="utf-8" standalone="no"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.demo" android:versionName="1.2.0" android:versionCode="12">
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:label="@string/app_name" android:icon="@mipmap/ic_launcher">
    <activity android:name=".MainActivity" android:label="@string/app_name">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    <activity android:name=".GameActivity" android:label="@string/game_title" />
  </application>
</manifest>`),
  );

  files.set(
    'res/values/strings.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Démo APK2WEB</string>
  <string name="game_title">Partie</string>
  <string name="welcome">Bienvenue &amp; bonne visite</string>
  <string name="play">Jouer</string>
  <string name="back">Retour</string>
  <string name="footer">Pied de page</string>
</resources>`),
  );

  files.set(
    'res/values/colors.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="primary">#FF3F51B5</color>
  <color name="background">#FFFFFFFF</color>
  <color name="textColor">#FF111111</color>
</resources>`),
  );

  files.set(
    'res/values/dimens.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <dimen name="space">16dp</dimen>
  <dimen name="title">22sp</dimen>
</resources>`),
  );

  files.set(
    'res/values/arrays.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string-array name="items">
    <item>Premier</item>
    <item>Deuxième</item>
  </string-array>
</resources>`),
  );

  files.set(
    'res/values/public.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <public type="layout" name="activity_main" id="0x7f0b0001" />
  <public type="layout" name="activity_game" id="0x7f0b0002" />
  <public type="layout" name="footer" id="0x7f0b0003" />
  <public type="id" name="button_play" id="0x7f080001" />
  <public type="id" name="button_back" id="0x7f080002" />
</resources>`),
  );

  files.set(
    'res/layout/activity_main.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="@dimen/space"
    android:background="@color/background">
  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/welcome"
      android:textSize="@dimen/title"
      android:textColor="@color/textColor"
      android:gravity="center" />
  <ImageView
      android:layout_width="120dp"
      android:layout_height="120dp"
      android:src="@drawable/logo"
      android:contentDescription="Logo" />
  <Button
      android:id="@+id/button_play"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/play"
      android:background="@drawable/rounded" />
  <EditText
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:hint="@string/footer"
      android:inputType="number" />
  <ListView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:entries="@array/items" />
  <include layout="@layout/footer" />
</LinearLayout>`),
  );

  files.set(
    'res/layout/activity_game.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/primary">
  <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="@string/game_title"
      android:layout_centerInParent="true" />
  <Button
      android:id="@+id/button_back"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_alignParentBottom="true"
      android:text="@string/back" />
</FrameLayout>`),
  );

  files.set(
    'res/layout/footer.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<TextView xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:text="@string/footer"
    android:visibility="visible" />`),
  );

  files.set(
    'res/drawable/rounded.xml',
    text(`<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="@color/primary" />
  <corners android:radius="12dp" />
  <stroke android:width="2dp" android:color="#FF000000" />
</shape>`),
  );

  files.set('res/drawable-xhdpi/logo.png', pngBytes());
  files.set('res/mipmap-xxxhdpi/ic_launcher.png', pngBytes());

  files.set(
    'smali/com/example/demo/MainActivity.smali',
    text(`.class public Lcom/example/demo/MainActivity;
.super Landroidx/appcompat/app/AppCompatActivity;

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2
    invoke-super {p0, p1}, Landroidx/appcompat/app/AppCompatActivity;->onCreate(Landroid/os/Bundle;)V
    const v0, 0x7f0b0001
    invoke-virtual {p0, v0}, Lcom/example/demo/MainActivity;->setContentView(I)V
    const v0, 0x7f080001
    invoke-virtual {p0, v0}, Lcom/example/demo/MainActivity;->findViewById(I)Landroid/view/View;
    move-result-object v0
    new-instance v1, Lcom/example/demo/MainActivity$1;
    invoke-direct {v1, p0}, Lcom/example/demo/MainActivity$1;-><init>(Lcom/example/demo/MainActivity;)V
    invoke-virtual {v0, v1}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V
    return-void
.end method`),
  );

  files.set(
    'smali/com/example/demo/MainActivity$1.smali',
    text(`.class Lcom/example/demo/MainActivity$1;
.super Ljava/lang/Object;
.implements Landroid/view/View$OnClickListener;

.method public onClick(Landroid/view/View;)V
    .locals 2
    new-instance v0, Landroid/content/Intent;
    invoke-direct {v0}, Landroid/content/Intent;-><init>()V
    const-class v1, Lcom/example/demo/GameActivity;
    invoke-virtual {v0, p0, v1}, Landroid/content/Intent;->setClass(Landroid/content/Context;Ljava/lang/Class;)Landroid/content/Intent;
    invoke-virtual {p0, v0}, Lcom/example/demo/MainActivity;->startActivity(Landroid/content/Intent;)V
    return-void
.end method`),
  );

  files.set(
    'smali/com/example/demo/GameActivity.smali',
    text(`.class public Lcom/example/demo/GameActivity;
.super Landroid/app/Activity;

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2
    const v0, 0x7f0b0002
    invoke-virtual {p0, v0}, Lcom/example/demo/GameActivity;->setContentView(I)V
    const v0, 0x7f080002
    invoke-virtual {p0, v0}, Lcom/example/demo/GameActivity;->findViewById(I)Landroid/view/View;
    move-result-object v0
    new-instance v1, Lcom/example/demo/GameActivity$1;
    invoke-direct {v1, p0}, Lcom/example/demo/GameActivity$1;-><init>(Lcom/example/demo/GameActivity;)V
    invoke-virtual {v0, v1}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V
    return-void
.end method`),
  );

  files.set(
    'smali/com/example/demo/GameActivity$1.smali',
    text(`.class Lcom/example/demo/GameActivity$1;
.super Ljava/lang/Object;
.implements Landroid/view/View$OnClickListener;

.method public onClick(Landroid/view/View;)V
    .locals 0
    invoke-virtual {p0}, Lcom/example/demo/GameActivity;->finish()V
    return-void
.end method`),
  );

  files.set('assets/sounds/click.ogg', new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]));
  files.set('assets/fonts/custom.ttf', new Uint8Array([0, 1, 0, 0, 0, 9]));
  files.set('assets/config.json', text('{"level":1}'));
  files.set('lib/arm64-v8a/libnative-helper.so', new Uint8Array([127, 69, 76, 70]));

  return files;
}

/** An undecompiled APK: binary manifest, no layouts, Unity engine. */
export function apkOnlyProject(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set('AndroidManifest.xml', new Uint8Array([0x03, 0x00, 0x08, 0x00, 0x9a, 0x01]));
  files.set('lib/arm64-v8a/libunity.so', new Uint8Array([127, 69, 76, 70, 1, 2]));
  files.set('assets/bin/Data/data.unity3d', new Uint8Array([1, 2, 3, 4, 5]));
  files.set('res/drawable/icon.png', pngBytes());
  files.set('assets/sounds/theme.mp3', new Uint8Array([73, 68, 51, 4, 0]));
  files.set('assets/fonts/game.ttf', new Uint8Array([0, 1, 0, 0]));
  return files;
}

export function readFixtureText(files: Map<string, Uint8Array>, path: string): string | null {
  const bytes = files.get(path);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export function fixtureBlob(files: Map<string, Uint8Array>, path: string): Blob | undefined {
  const bytes = files.get(path);
  if (!bytes) return undefined;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer]);
}

export function fixtureDataUrl(files: Map<string, Uint8Array>, path: string): Promise<string | null> {
  const bytes = files.get(path);
  if (!bytes) return Promise.resolve(null);
  return Promise.resolve(`data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`);
}
