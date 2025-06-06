const express = require('express');
const admin = require('firebase-admin');
const app = express();
app.use(express.json());


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

app.post('/send-notification', async (req, res) => {
  const { token, title, body, data } = req.body;
  try {
    const message = {
      token,
      notification: { title, body },
      data: data || {},
    };
    const response = await admin.messaging().send(message);
    res.json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => res.send('Servidor de notificaciones funcionando'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor escuchando en puerto', PORT);
}); 
