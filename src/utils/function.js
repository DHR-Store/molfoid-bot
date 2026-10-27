// utils/function.js

function parseTime(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.match(/^(\d+)([smhd])$/i);
  if (!match) return 0;
  
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

/**
 * Pro-level purge function supporting Amount, User, and Time filters.
 */
async function purgeMessages(message, args) {
  const isDM = !message.guild;
  if (!isDM && !message.channel.permissionsFor(message.guild.members.me).has('ManageMessages')) {
    return message.reply("❌ I need the **Manage Messages** permission to delete messages!");
  }

  let limit = 50; // Default limit
  let timeMs = 0;
  let targetUserId = null;

  // Parse arguments (e.g., ["50"], ["@user", "1h"], ["1h"])
  for (const arg of args) {
    // Check if it's a number (amount)
    if (/^\d+$/.test(arg)) {
      limit = Math.min(parseInt(arg, 10), 100); // Max 100 for bulk delete
    } 
    // Check if it's a time
    else if (/^\d+[smhd]$/i.test(arg)) {
      timeMs = parseTime(arg);
    }
    // Check if it's a mention or ID
    else if (/^<@!?(\d{17,20})>$/.test(arg) || /^\d{17,20}$/.test(arg)) {
      const match = arg.match(/\d{17,20}/);
      if (match) targetUserId = match[0];
    }
  }

  try {
    const fetched = await message.channel.messages.fetch({ limit });
    
    let toDelete = fetched.filter(msg => {
      // Time filter
      if (timeMs > 0 && (Date.now() - msg.createdTimestamp) > timeMs) return false;
      // User filter
      if (targetUserId && msg.author.id !== targetUserId) return false;
      return true;
    });

    // DM Constraint
    if (isDM) {
      toDelete = toDelete.filter(msg => msg.author.id === message.client.user.id);
      if (toDelete.size === 0) {
        return message.reply("❌ In DMs, I can only delete **my own** messages.");
      }
    }

    if (toDelete.size === 0) {
      return message.reply(`*sends a smug sticker* Tch... I couldn't find any messages matching those filters.`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
    }

    // Delete execution
    if (isDM || toDelete.size === 1) {
      for (const msg of toDelete.values()) await msg.delete().catch(() => {});
      return message.reply(`✅ Deleted ${toDelete.size} message(s).`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    } else {
      const deleted = await message.channel.bulkDelete(toDelete, true);
      return message.reply(`✅ Bulk deleted ${deleted.size} message(s).`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

  } catch (error) {
    console.error('Purge error:', error);
    return message.reply("❌ Something went wrong (messages might be older than 14 days).");
  }
}

module.exports = { purgeMessages };