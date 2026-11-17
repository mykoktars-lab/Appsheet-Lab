# Panduan LabStock Versi Bersama (Firebase)

Semua HP memakai data yang sama, tersimpan online. Gratis untuk sekitar 6 orang.

## 1. Buat proyek Firebase
1. Buka https://console.firebase.google.com, masuk dengan akun Google.
2. **Create a project** → nama `labstock` → matikan Google Analytics → **Create project**.

## 2. Aktifkan login (Authentication)
1. Menu **Build → Authentication → Get started**.
2. Tab **Sign-in method** → **Email/Password** → aktifkan → **Save**.
3. Tab **Users → Add user**: buat 6 akun (email + password). Email boleh karangan, mis. `rina@lab.com`.
4. Tab **Settings → User actions**: matikan **Enable create (sign-up)** supaya orang lain tidak bisa mendaftar sendiri.
5. Tab **Settings → Authorized domains → Add domain**: isi `USERNAME.github.io` (tanpa https dan tanpa nama repo).

## 3. Buat database (Firestore)
1. **Build → Firestore Database → Create database**.
2. Lokasi: `asia-southeast2` (Jakarta) atau terdekat. Mode: **Production**.
3. Tab **Rules**, hapus semua isinya, tempel ini, lalu **Publish**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## 4. Ambil konfigurasi
1. Ikon roda gigi → **Project settings** → bagian **Your apps** → ikon web `</>`.
2. Nama bebas (mis. `labstock-web`), **jangan** centang Hosting → **Register app**.
3. Salin isi `firebaseConfig = { ... }`.

## 5. Isi config.js dan upload ke GitHub
1. Di repo GitHub, buka `config.js` → ikon pensil.
2. Ganti isi tanda kurung `{ ... }` dengan config dari langkah 4. Pastikan nama barisnya sama (`apiKey`, `authDomain`, `projectId`, ...).
3. **Commit changes**.
4. Upload file lain dari ZIP ini yang berubah (`index.html`, `app.js`, `style.css`, `sw.js`), timpa yang lama.

## 6. Pakai
1. Buka alamat aplikasi, login dengan akun dari langkah 2.
2. Jika sebelumnya sudah ada data di HP: menu ☰ → **Pindahkan data lama ke database bersama** (cukup di satu HP).
3. Bagikan alamat aplikasi dan akun ke rekan. Mereka install seperti biasa (menu ⋮ → Instal aplikasi).

## Catatan
- Sinyal hilang: tetap bisa mencatat, otomatis sinkron saat online. Pertama kali buka wajib ada internet.
- Lupa password: Firebase Console → Authentication → Users → ⋮ → **Reset password**.
- `apiKey` di config bukan rahasia. Pengamannya adalah login dan Rules di langkah 3.
- Backup: menu ☰ → **Backup (JSON)** secara berkala.
