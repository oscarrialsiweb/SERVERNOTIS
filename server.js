const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const app = express();
app.use(express.json());
app.use(cors()); // Habilitar CORS para pruebas

const serviceAccount = {
  type: process.env.type,
  project_id: process.env.project_id,
  private_key_id: process.env.private_key_id,
  private_key: process.env.private_key.replace(/\\n/g, '\n'),
  client_email: process.env.client_email,
  client_id: process.env.client_id,
  auth_uri: process.env.auth_uri,
  token_uri: process.env.token_uri,
  auth_provider_x509_cert_url: process.env.auth_provider_x509_cert_url,
  client_x509_cert_url: process.env.client_x509_cert_url,
  universe_domain: process.env.universe_domain
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Inicializa SQLite
const db = new sqlite3.Database(process.env.DATABASE_URL || './data/reminders.db');

// Asegurarse que el directorio existe
const fs = require('fs');
const path = require('path');
const dbDir = path.dirname(process.env.DATABASE_URL || './data/reminders.db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

db.run(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT,
    title TEXT,
    body TEXT,
    hour TEXT,
    frequency TEXT,
    daysOfWeek TEXT,
    startDate TEXT,
    endDate TEXT,
    medication_id TEXT
  )
`);

// Crear o editar recordatorio
app.post('/reminders', (req, res) => {
  const { token, title, body, hour, frequency, daysOfWeek, startDate, endDate, medication_id } = req.body;
  if (!token || !title || !body || !hour || !frequency || !medication_id) {
    return res.status(400).json({ success: false, error: 'Faltan campos requeridos.' });
  }
  db.run(
    `INSERT INTO reminders (token, title, body, hour, frequency, daysOfWeek, startDate, endDate, medication_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [token, title, body, hour, frequency, JSON.stringify(daysOfWeek || []), startDate, endDate, medication_id],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Eliminar recordatorio
app.delete('/reminders/:id', (req, res) => {
  db.run('DELETE FROM reminders WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

// Eliminar todos los recordatorios de un medicamento
app.delete('/reminders/medication/:medicationId', (req, res) => {
  db.run('DELETE FROM reminders WHERE medication_id = ?', [req.params.medicationId], function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

// Listar recordatorios (opcional, para debug)
app.get('/reminders', (req, res) => {
  db.all('SELECT * FROM reminders', [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, reminders: rows });
  });
});

// Cron job: revisa cada minuto si hay recordatorios para enviar
cron.schedule('* * * * *', () => {
  const now = new Date();
  const hour = now.toTimeString().slice(0, 5); // "HH:MM"
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1=Lunes, 7=Domingo
  const today = now.toISOString().slice(0, 10);

   console.log('Revisando recordatorios para:', hour, today);

  db.all(
    `SELECT * FROM reminders WHERE hour = ? AND (startDate IS NULL OR startDate <= ?) AND (endDate IS NULL OR endDate >= ?)`,
    [hour, today, today],
    (err, rows) => {
      if (err) return;
      rows.forEach(reminder => {
        // Lógica de frecuencia
        if (reminder.frequency === 'daily' ||
            (reminder.frequency === 'weekly' && JSON.parse(reminder.daysOfWeek).includes(dayOfWeek))) {
          // Envía la notificación
          const message = {
            token: reminder.token,
            notification: { title: reminder.title, body: reminder.body },
            data: {
              medication_id: reminder.medication_id,
              medication_name: reminder.title,
              hora: reminder.hour,
              type: 'medication_reminder'
            },
          };
          admin.messaging().send(message)
            .then(() => console.log('Notificación enviada:', reminder.title, reminder.hour))
            .catch(e => console.error('Error enviando notificación:', e));
        }
      });
    }
  );
});

app.get('/', (req, res) => res.send('Servidor de notificaciones funcionando'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
}); 
