const { Vonage } = require('@vonage/server-sdk')

const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
})

vonage.sms.send({
  to: process.env.VONAGE_TEST_TO,
  from: process.env.VONAGE_FROM_NUMBER || 'Cornhole',
  text: 'Test message from Cornhole tournament app',
})
  .then(resp => {
    if (resp.messages[0].status === '0') console.log('Sent successfully!')
    else console.error('Failed:', resp.messages[0]['error-text'])
  })
  .catch(err => console.error(err))
