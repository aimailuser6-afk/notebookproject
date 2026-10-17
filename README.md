# NoteBook - Personal Cloud Workspace

A private personal cloud workspace and notebook application with secure password authentication, dark mode interface, and cloud backup.

## 🚀 Features
- 🔐 Secure AES-256 HMAC Vault Authentication
- ⚡ Fast Express & Node.js backend
- 📱 Responsive modern web interface
- 🔄 Automatic session keeping

## 🛠️ Getting Started

### Local Setup
1. Clone the repository:
```bash
git clone https://github.com/aimailuser6-afk/notebookproject.git
cd notebookproject
```

2. Install dependencies:
```bash
npm install
```

3. Start application:
```bash
npm start
```

4. Open in browser at `http://localhost:3000`.

## ☁️ Deployment on Render

1. Connect this GitHub repository on [Render](https://dashboard.render.com).
2. Create a new **Web Service**.
3. Set Environment Variable (Optional):
   - `ADMIN_PASSWORD`: `#Admin@123` (or any custom password you choose)
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Keep-Alive URL: `https://<your-render-app>.onrender.com/ping`
