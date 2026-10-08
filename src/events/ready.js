module.exports = {
  name: 'clientReady',        // was 'ready' — new name for v15
  once: true,
  execute(client) {
    console.log(`✅ Molfoid is online as ${client.user.tag}`);
    client.user.setActivity('Your own HEART');
  },
};