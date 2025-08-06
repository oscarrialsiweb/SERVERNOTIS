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

// Crear múltiples recordatorios de una vez (más eficiente)
app.post('/reminders/batch', (req, res) => {
  const { reminders } = req.body;
  if (!reminders || !Array.isArray(reminders) || reminders.length === 0) {
    return res.status(400).json({ success: false, error: 'Se requiere un array de recordatorios.' });
  }

  const stmt = db.prepare(
    `INSERT INTO reminders (token, title, body, hour, frequency, daysOfWeek, startDate, endDate, medication_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const results = [];
  let hasError = false;

  reminders.forEach((reminder, index) => {
    const { token, title, body, hour, frequency, daysOfWeek, startDate, endDate, medication_id } = reminder;
    
    if (!token || !title || !body || !hour || !frequency || !medication_id) {
      hasError = true;
      results.push({ index, success: false, error: 'Faltan campos requeridos' });
      return;
    }

    stmt.run(
      [token, title, body, hour, frequency, JSON.stringify(daysOfWeek || []), startDate, endDate, medication_id],
      function (err) {
        if (err) {
          hasError = true;
          results.push({ index, success: false, error: err.message });
        } else {
          results.push({ index, success: true, id: this.lastID });
        }
      }
    );
  });

  stmt.finalize((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    
    if (hasError) {
      return res.status(207).json({ success: false, results }); // 207 Multi-Status
    } else {
      return res.json({ success: true, results });
    }
  });
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

// Endpoint para obtener tomas pendientes de un usuario
app.get('/pending-intakes/:userId', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.all(
    `SELECT r.* FROM reminders r
      WHERE (r.startDate IS NULL OR r.startDate <= ?) 
        AND (r.endDate IS NULL OR r.endDate >= ?)
        AND NOT EXISTS (
          SELECT 1 FROM intakes i
          WHERE i.user_id = ? AND i.medication_id = r.medication_id
            AND i.fecha = ? AND i.hora = r.hour AND i.tomada = 1
        )`,
    [today, today, req.params.userId, today],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, pending: rows });
    }
  );
});

// Endpoint de prueba para enviar notificación manual
app.post('/test-notification', (req, res) => {
  const { token, title, body } = req.body;
  
  if (!token || !title || !body) {
    return res.status(400).json({ success: false, error: 'Faltan campos requeridos: token, title, body' });
  }
  
  console.log('🔧 Enviando notificación de prueba...');
  console.log('Token:', token ? token.substring(0, 20) + '...' : 'NO TOKEN');
  console.log('Title:', title);
  console.log('Body:', body);
  
  const message = {
    token: token,
    notification: { 
      title: title, 
      body: body 
    },
    data: {
      type: 'test_notification',
      timestamp: new Date().toISOString()
    },
  };
  
  admin.messaging().send(message)
    .then((response) => {
      console.log('✅ Notificación de prueba enviada exitosamente:', response);
      res.json({ success: true, response: response });
    })
    .catch((error) => {
      console.error('❌ Error enviando notificación de prueba:', {
        error: error.message,
        errorCode: error.code,
        fullError: error
      });
      res.status(500).json({ 
        success: false, 
        error: error.message,
        errorCode: error.code 
      });
    });
});

// Cron job para enviar notificaciones
cron.schedule('* * * * *', () => {
  const now = new Date();
  const currentHour = now.toTimeString().slice(0, 5); // "HH:MM"
  const hourOnly = now.toTimeString().slice(0, 2); // "HH" (solo hora)
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1=Lunes, 7=Domingo
  const today = now.toISOString().slice(0, 10);

  console.log('Revisando recordatorios para hora:', hourOnly, 'minuto actual:', now.getMinutes(), today);

  // Buscar recordatorios para la hora actual (solo cuando es el minuto 0)
  if (now.getMinutes() === 0) {
    db.all(
      `SELECT * FROM reminders 
       WHERE hour LIKE ? 
       AND (startDate IS NULL OR startDate <= ?) 
       AND (endDate IS NULL OR endDate >= ?)`,
      [hourOnly + '%', today, today],
      (err, rows) => {
        if (err) {
          console.error('Error consultando recordatorios:', err);
          return;
        }
        
        console.log(`Encontrados ${rows.length} recordatorios para la hora ${hourOnly}`);
        
        rows.forEach((reminder, index) => {
          console.log(`Recordatorio ${index + 1}:`, {
            id: reminder.id,
            title: reminder.title,
            hour: reminder.hour,
            token: reminder.token ? reminder.token.substring(0, 20) + '...' : 'NO TOKEN',
            frequency: reminder.frequency,
            medication_id: reminder.medication_id
          });
          
          // Lógica de frecuencia
          if (
            reminder.frequency === 'daily' ||
            (reminder.frequency === 'weekly' && JSON.parse(reminder.daysOfWeek).includes(dayOfWeek))
          ) {
            console.log(`Recordatorio ${index + 1} cumple criterios de frecuencia`);
            
            // Antes de enviar la notificación, verifica si ya está tomada
            db.get(
              'SELECT 1 FROM intakes WHERE medication_id = ? AND fecha = ? AND hora = ? AND tomada = 1',
              [reminder.medication_id, today, reminder.hour],
              (err, row) => {
                if (err) {
                  console.error(`Error verificando intake para recordatorio ${index + 1}:`, err);
                  return;
                }
                
                if (!row) {
                  console.log(`Enviando notificación para recordatorio ${index + 1}: ${reminder.title} a las ${reminder.hour}`);
                  
                  // Envía la notificación solo si no está tomada
                  const message = {
                    token: reminder.token,
                    notification: { title: reminder.title, body: reminder.body },
                    data: {
                      medication_id: reminder.medication_id,
                      hora: reminder.hour,
                      type: 'medication_reminder',
                    },
                  };
                  
                  console.log('Mensaje a enviar:', {
                    token: message.token ? message.token.substring(0, 20) + '...' : 'NO TOKEN',
                    title: message.notification.title,
                    body: message.notification.body,
                    data: message.data
                  });
                  
                  admin.messaging().send(message)
                    .then((response) => {
                      console.log('✅ Notificación enviada exitosamente:', {
                        reminder_id: reminder.id,
                        title: reminder.title,
                        hour: reminder.hour,
                        response: response
                      });
                    })
                    .catch((error) => {
                      console.error('❌ Error enviando notificación:', {
                        reminder_id: reminder.id,
                        title: reminder.title,
                        hour: reminder.hour,
                        error: error.message,
                        errorCode: error.code,
                        fullError: error
                      });
                    });
                } else {
                  console.log(`Recordatorio ${index + 1} ya fue tomado, no se envía notificación`);
                }
              }
            );
          } else {
            console.log(`Recordatorio ${index + 1} no cumple criterios de frecuencia`);
          }
        });
      }
    );
  } else {
    console.log(`No es el minuto 0 (es ${now.getMinutes()}), no se procesan recordatorios`);
  }
});

app.get('/', (req, res) => res.send('Servidor de notificaciones funcionando'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
}); 
