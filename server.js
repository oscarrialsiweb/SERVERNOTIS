// Modificar el cron job para no enviar notificaciones de tomas ya realizadas
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
