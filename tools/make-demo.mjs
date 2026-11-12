/**
 * Génère examples/DemoProject (projet décompilé factice) et examples/DemoProject.zip.
 * Aucun APK réel n'est distribué : ce projet sert à tester l'import et la conversion.
 *
 *   node tools/make-demo.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';

const OUT = 'examples/DemoProject';
const ZIP = 'examples/DemoProject.zip';

/** Minimal PNG encoder (solid colour with a diagonal highlight). */
function makePng(size = 128) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      const t = (x + y) / (size * 2);
      raw[i] = Math.round(124 + 40 * t);
      raw[i + 1] = Math.round(92 + 140 * t);
      raw[i + 2] = Math.round(255 - 60 * t);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Short 440 Hz click as PCM WAV. */
function makeWav() {
  const rate = 22050;
  const samples = Math.floor(rate * 0.18);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const env = Math.exp(-i / (rate * 0.05));
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 660 * i) / rate) * 12000 * env), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const files = {
  'AndroidManifest.xml': `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.apk2web.demo" android:versionName="1.0.0" android:versionCode="1">
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
</manifest>`,

  'res/values/strings.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Démo APK2WEB</string>
  <string name="game_title">Espace de jeu</string>
  <string name="welcome">Reconstruit depuis un APK Android</string>
  <string name="subtitle">Les ressources sont réelles, la logique est simulée.</string>
  <string name="start">Commencer</string>
  <string name="settings">Afficher les options</string>
  <string name="back">Retour</string>
  <string name="score">Score</string>
  <string name="items_title">Éléments détectés</string>
  <string name="footer">Généré par APK2WEB</string>
</resources>`,

  'res/values/colors.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="primary">#FF6A5CFF</color>
  <color name="background">#FFFFFFFF</color>
  <color name="textColor">#FF161A24</color>
  <color name="muted">#FF6B7385</color>
</resources>`,

  'res/values/dimens.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <dimen name="screen_padding">24dp</dimen>
  <dimen name="title_size">28sp</dimen>
</resources>`,

  'res/values/arrays.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string-array name="screens">
    <item>Accueil</item>
    <item>Espace de jeu</item>
  </string-array>
</resources>`,

  'res/values/public.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <public type="layout" name="activity_main" id="0x7f0b0001" />
  <public type="layout" name="activity_game" id="0x7f0b0002" />
  <public type="id" name="button_start" id="0x7f080001" />
  <public type="id" name="button_back" id="0x7f080002" />
</resources>`,

  'res/layout/activity_main.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center_horizontal"
    android:padding="@dimen/screen_padding"
    android:background="@color/background">

  <ImageView
      android:layout_width="112dp"
      android:layout_height="112dp"
      android:layout_marginTop="24dp"
      android:src="@drawable/logo"
      android:contentDescription="Logo APK2WEB" />

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="20dp"
      android:text="@string/welcome"
      android:textSize="@dimen/title_size"
      android:textStyle="bold"
      android:textColor="@color/textColor"
      android:gravity="center" />

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="8dp"
      android:text="@string/subtitle"
      android:textColor="@color/muted"
      android:textSize="14sp"
      android:gravity="center" />

  <Button
      android:id="@+id/button_start"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="28dp"
      android:text="@string/start"
      android:textAllCaps="false"
      android:background="@drawable/rounded_primary" />

  <CheckBox
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="12dp"
      android:text="@string/settings"
      android:checked="true" />

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="28dp"
      android:text="@string/items_title"
      android:textStyle="bold"
      android:textColor="@color/textColor" />

  <ListView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="8dp"
      android:entries="@array/screens" />

  <View
      android:layout_width="match_parent"
      android:layout_height="0dp"
      android:layout_weight="1" />

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/footer"
      android:textColor="@color/muted"
      android:textSize="12sp"
      android:gravity="center" />
</LinearLayout>`,

  'res/layout/activity_game.xml': `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/primary"
    android:padding="@dimen/screen_padding">

  <LinearLayout
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_centerInParent="true"
      android:orientation="vertical"
      android:gravity="center">

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="@string/game_title"
        android:textSize="26sp"
        android:textStyle="bold"
        android:textColor="#FFFFFFFF"
        android:gravity="center" />

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:text="@string/score"
        android:textColor="#CCFFFFFF"
        android:gravity="center" />

    <SeekBar
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="20dp"
        android:max="100"
        android:progress="40" />
  </LinearLayout>

  <Button
      android:id="@+id/button_back"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_alignParentBottom="true"
      android:text="@string/back"
      android:background="@drawable/rounded_light" />
</FrameLayout>`,

  'res/drawable/rounded_primary.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="@color/primary" />
  <corners android:radius="14dp" />
</shape>`,

  'res/drawable/rounded_light.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#FFFFFFFF" />
  <corners android:radius="12dp" />
  <stroke android:width="1dp" android:color="#FF6A5CFF" />
</shape>`,

  'smali/com/apk2web/demo/MainActivity.smali': `.class public Lcom/apk2web/demo/MainActivity;
.super Landroidx/appcompat/app/AppCompatActivity;

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2
    invoke-super {p0, p1}, Landroidx/appcompat/app/AppCompatActivity;->onCreate(Landroid/os/Bundle;)V
    const v0, 0x7f0b0001
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/MainActivity;->setContentView(I)V
    const v0, 0x7f080001
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/MainActivity;->findViewById(I)Landroid/view/View;
    move-result-object v0
    new-instance v1, Lcom/apk2web/demo/MainActivity$1;
    invoke-direct {v1, p0}, Lcom/apk2web/demo/MainActivity$1;-><init>(Lcom/apk2web/demo/MainActivity;)V
    invoke-virtual {v0, v1}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V
    return-void
.end method`,

  'smali/com/apk2web/demo/MainActivity$1.smali': `.class Lcom/apk2web/demo/MainActivity$1;
.super Ljava/lang/Object;
.implements Landroid/view/View$OnClickListener;

.method public onClick(Landroid/view/View;)V
    .locals 2
    new-instance v0, Landroid/content/Intent;
    invoke-direct {v0}, Landroid/content/Intent;-><init>()V
    const-class v1, Lcom/apk2web/demo/GameActivity;
    invoke-virtual {v0, p0, v1}, Landroid/content/Intent;->setClass(Landroid/content/Context;Ljava/lang/Class;)Landroid/content/Intent;
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/MainActivity;->startActivity(Landroid/content/Intent;)V
    return-void
.end method`,

  'smali/com/apk2web/demo/GameActivity.smali': `.class public Lcom/apk2web/demo/GameActivity;
.super Landroid/app/Activity;

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2
    const v0, 0x7f0b0002
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/GameActivity;->setContentView(I)V
    const v0, 0x7f080002
    invoke-virtual {p0, v0}, Lcom/apk2web/demo/GameActivity;->findViewById(I)Landroid/view/View;
    move-result-object v0
    new-instance v1, Lcom/apk2web/demo/GameActivity$1;
    invoke-direct {v1, p0}, Lcom/apk2web/demo/GameActivity$1;-><init>(Lcom/apk2web/demo/GameActivity;)V
    invoke-virtual {v0, v1}, Landroid/view/View;->setOnClickListener(Landroid/view/View$OnClickListener;)V
    return-void
.end method`,

  'smali/com/apk2web/demo/GameActivity$1.smali': `.class Lcom/apk2web/demo/GameActivity$1;
.super Ljava/lang/Object;
.implements Landroid/view/View$OnClickListener;

.method public onClick(Landroid/view/View;)V
    .locals 0
    invoke-virtual {p0}, Lcom/apk2web/demo/GameActivity;->finish()V
    return-void
.end method`,

  'assets/config.json': '{\n  "demo": true,\n  "generatedBy": "tools/make-demo.mjs"\n}\n',
};

const binary = {
  'res/drawable-xxhdpi/logo.png': makePng(128),
  'res/mipmap-xxxhdpi/ic_launcher.png': makePng(72),
  'assets/sounds/click.wav': makeWav(),
};

const entries = [];
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), content);
  entries.push([path, new TextEncoder().encode(content)]);
}
for (const [path, buffer] of Object.entries(binary)) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), buffer);
  entries.push([path, new Uint8Array(buffer)]);
}

const zipped = zipSync(Object.fromEntries(entries.map(([path, data]) => [path, data])), { level: 6 });
writeFileSync(ZIP, zipped);
console.log(`Projet démo écrit dans ${OUT} et ${ZIP} (${entries.length} fichiers, ${zipped.length} octets).`);
