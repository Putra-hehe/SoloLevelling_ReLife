# SoloLevelling Productivity

Aplikasi produktivitas bergaya RPG (quests, habits, fokus timer, badges) dengan penyimpanan lokal **dan** sinkronisasi ke **Firebase Firestore**.

## Jalankan di lokal

```bash
npm install
npm run dev
```

> Repo ini memakai **workspaces**. App Vite ada di folder `Solo-main/`.

## Firebase (.env.local)

Buat file `Solo-main/.env.local` (di folder yang sama dengan `Solo-main/package.json`):

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
```

Lihat contoh di `Solo-main/.env.example`.

## Login Google & Facebook + Authorized Domains

1) Di **Firebase Console → Authentication → Sign-in method**, aktifkan:
- Email/Password
- Google
- Facebook

2) **Authorized domains** (WAJIB agar OAuth tidak error `auth/unauthorized-domain`):
- Firebase Console → Authentication → Settings → Authorized domains
- Tambahkan domain deploy kamu, misalnya:
  - `your-project.vercel.app`
  - domain custom kamu (jika ada)

3) Untuk **Facebook**, pastikan:
- `Facebook App Dashboard → Settings` sudah mengisi `Valid OAuth Redirect URIs`
- Salin nilai redirect dari Firebase Console (Sign-in method → Facebook) dan tempelkan.

## Deploy ke Vercel

Di Vercel (Project Settings):

- **Framework**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: **`Solo-main/dist`**
- **Root Directory**: biarkan root repo (jangan pindah) — karena scripts/workspaces sudah mengarah ke `Solo-main`.

> Repo ini juga sudah punya `vercel.json` yang mengarah ke `Solo-main/dist`. Kalau Vercel tetap mencari `dist` di root, cek apakah di Project Settings kamu pernah mengisi Output Directory menjadi `dist` dan hapus / ubah jadi `Solo-main/dist`.

## Catatan stabilitas (penting)

- Sinkronisasi Firestore sudah **digate** agar tidak terjadi race: local state tidak akan menimpa remote state saat pertama login.
- Save ke Firestore sudah **debounce** dan akan di-**flush** saat tab/app ditutup (lebih aman di mobile).
- Difficulty Select di `QuestCreateDialog` sudah dibuat lebih aman untuk beberapa HP yang bikin blank white page.
# SoloLevelling_ReLife
