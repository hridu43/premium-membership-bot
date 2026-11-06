
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const BKASH = process.env.BKASH_NUMBER;

const GROUPS = [
  {
    name: "প্রিমিয়াম গ্রুপ 1",
    desc: "দেশি বাচ্চাদের ভিডিও",
    link: process.env.GROUP1_LINK
  },
  {
    name: "প্রিমিয়াম গ্রুপ 2",
    desc: "বিদেশি বাচ্চাদের ভিডিও",
    link: process.env.GROUP2_LINK
  },
  {
    name: "প্রিমিয়াম গ্রুপ 3",
    desc: "বাংলাদেশি ভাইরাল লিংক",
    link: process.env.GROUP3_LINK
  }
];

if (!TOKEN || !ADMIN_ID || !BKASH ||
    GROUPS.some(g => !g.link)) {
  throw new Error("প্রয়োজনীয় Environment Variables দেওয়া হয়নি।");
}

const bot = new TelegramBot(TOKEN, { polling: true });
const users = new Map();

const DB = "orders.json";

function loadOrders() {
  try {
    return JSON.parse(fs.readFileSync(DB, "utf8"));
  } catch {
    return {};
  }
}

let orders = loadOrders();

function saveOrders() {
  fs.writeFileSync(DB, JSON.stringify(orders, null, 2));
}

function price(count) {
  if (count === 1) return 150;
  if (count === 2) return 250;
  if (count === 3) return 320;
  return 0;
}

function selectionText(selected) {
  return "আপনি কোন কোন গ্রুপ নিতে চান?\n\n" +
    "আমাদের গ্রুপগুলো সারা জীবনের জন্য।\n\n" +
    GROUPS.map((g, i) =>
      `${selected.includes(i) ? "☑️" : "⬜"} ${g.name} — 150 টাকা\n(${g.desc})`
    ).join("\n\n") +
    "\n\nনির্বাচিত গ্রুপ: " + selected.length + " টি" +
    "\nমোট মূল্য: " + price(selected.length) + " টাকা";
}

function selectionKeyboard(selected) {
  return {
    inline_keyboard: [
      ...GROUPS.map((g, i) => [{
        text: (selected.includes(i) ? "☑️ " : "⬜ ") + g.name,
        callback_data: "toggle_" + i
      }]),
      [{
        text: "এগিয়ে যান",
        callback_data: "next"
      }]
    ]
  };
}

async function showSelection(chatId, messageId, selected) {
  const options = {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: selectionKeyboard(selected)
  };

  if (messageId) {
    await bot.editMessageText(
      selectionText(selected),
      options
    );
  } else {
    await bot.sendMessage(
      chatId,
      selectionText(selected),
      { reply_markup: selectionKeyboard(selected) }
    );
  }
}

bot.onText(/\/start/, async (msg) => {
  users.set(msg.chat.id, {
    step: "select",
    selected: []
  });

  await bot.sendMessage(
    msg.chat.id,
    "👋 স্বাগতম!\n\nআমাদের প্রিমিয়াম মেম্বারশিপ বটে আপনাকে স্বাগতম।\n\nনিচের গ্রুপগুলো থেকে আপনার পছন্দ নির্বাচন করুন।"
  );

  await showSelection(msg.chat.id, null, []);
});

async function createOrder(user, proofType, proof) {
  const state = users.get(user.id);
  const selected = state.selected;

  const id = Date.now().toString() + user.id;

  const order = {
    id,
    userId: user.id,
    name: user.first_name || "অজানা",
    username: user.username || "নেই",
    selected,
    amount: price(selected.length),
    proofType,
    proof,
    status: "pending",
    date: new Date().toISOString()
  };

  orders[id] = order;
  saveOrders();

  users.set(user.id, { step: "submitted" });

  await bot.sendMessage(
    user.id,
    "✅ আপনার পেমেন্টের তথ্য জমা হয়েছে।\n\nঅ্যাডমিন আপনার পেমেন্ট যাচাই করছেন। অনুগ্রহ করে অপেক্ষা করুন।"
  );

  const details =
    "🔔 নতুন পেমেন্ট যাচাই করুন\n\n" +
    "ক্রেতার নাম: " + order.name + "\n" +
    "ইউজারনেম: @" + order.username + "\n" +
    "টেলিগ্রাম আইডি: " + order.userId + "\n\n" +
    "নির্বাচিত গ্রুপ:\n" +
    selected.map(i => GROUPS[i].name).join("\n") +
    "\n\nমোট টাকা: " + order.amount + " টাকা\n\n" +
    "প্রমাণের ধরন: " + proofType + "\n" +
    (proofType === "স্ক্রিনশট"
      ? "পেমেন্টের ছবি নিচে দেওয়া হয়েছে।"
      : "জমা দেওয়া তথ্য: " + proof);

  const keyboard = {
    inline_keyboard: [[
      { text: "✅ অনুমোদন", callback_data: "approve_" + id },
      { text: "❌ বাতিল", callback_data: "reject_" + id }
    ]]
  };

  if (proofType === "স্ক্রিনশট") {
    await bot.sendPhoto(ADMIN_ID, proof, {
      caption: details,
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(ADMIN_ID, details, {
      reply_markup: keyboard
    });
  }
}

bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  try {
    if (data.startsWith("toggle_")) {
      const index = Number(data.split("_")[1]);
      const state = users.get(chatId);

      if (!state || state.step !== "select") return;

      if (state.selected.includes(index)) {
        state.selected = state.selected.filter(i => i !== index);
      } else {
        state.selected.push(index);
      }

      await showSelection(
        chatId,
        query.message.message_id,
        state.selected
      );

      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === "next") {
      const state = users.get(chatId);

      if (!state || !state.selected.length) {
        await bot.answerCallbackQuery(query.id, {
          text: "অন্তত একটি গ্রুপ নির্বাচন করুন।",
          show_alert: true
        });
        return;
      }

      state.step = "payment";

      await bot.answerCallbackQuery(query.id);

      await bot.sendMessage(
        chatId,
        "💳 পেমেন্ট করুন\n\n" +
        "আপনার নির্বাচিত গ্রুপের জন্য মোট " +
        price(state.selected.length) + " টাকা দিতে হবে।\n\n" +
        "পেমেন্টের মাধ্যম: বিকাশ পার্সোনাল\n\n" +
        "বিকাশ নম্বর:\n" + BKASH +
        "\n\nবিশেষ সতর্কবার্তা ⚠️\n" +
        "পেমেন্ট করার পর অবশ্যই নিচের যেকোনো একটি তথ্য দিতে হবে:\n\n" +
        "1. ট্রানজেকশন আইডি\n" +
        "2. পেমেন্টের স্ক্রিনশট\n" +
        "3. বিকাশ নম্বরের শেষ 4 ডিজিট\n\n" +
        "এই তথ্য ছাড়া পেমেন্ট যাচাই করা সম্ভব হবে না।",
        {
          reply_markup: {
            inline_keyboard: [[
              { text: "পেমেন্ট করেছি", callback_data: "paid" }
            ]]
          }
        }
      );
      return;
    }

    if (data === "paid") {
      const state = users.get(chatId);
      if (!state || state.step !== "payment") return;

      state.step = "proof_choice";

      await bot.answerCallbackQuery(query.id);

      await bot.sendMessage(
        chatId,
        "পেমেন্টের প্রমাণ দিন।\n\nনিচের যেকোনো একটি নির্বাচন করুন:",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "ট্রানজেকশন আইডি", callback_data: "proof_txn" }],
              [{ text: "পেমেন্টের স্ক্রিনশট", callback_data: "proof_photo" }],
              [{ text: "শেষ 4 ডিজিট", callback_data: "proof_last" }]
            ]
          }
        }
      );
      return;
    }

    if (["proof_txn", "proof_photo", "proof_last"].includes(data)) {
      const state = users.get(chatId);
      if (!state || state.step !== "proof_choice") return;

      if (data === "proof_txn") {
        state.step = "proof_text";
        state.proofType = "ট্রানজেকশন আইডি";
        await bot.sendMessage(chatId, "আপনার ট্রানজেকশন আইডি লিখে পাঠান।");
      }

      if (data === "proof_last") {
        state.step = "proof_last";
        await bot.sendMessage(chatId, "যে বিকাশ নম্বর থেকে টাকা পাঠিয়েছেন তার শেষ 4 ডিজিট লিখুন।");
      }

      if (data === "proof_photo") {
        state.step = "proof_photo";
        await bot.sendMessage(chatId, "এখন পেমেন্টের স্ক্রিনশট পাঠান।");
      }

      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith("approve_") || data.startsWith("reject_")) {
      if (userId !== ADMIN_ID) {
        await bot.answerCallbackQuery(query.id, {
          text: "এই অনুমতি শুধু অ্যাডমিনের জন্য।",
          show_alert: true
        });
        return;
      }

      const id = data.substring(data.indexOf("_") + 1);
      const order = orders[id];

      if (!order || order.status !== "pending") {
        await bot.answerCallbackQuery(query.id, {
          text: "এই আবেদনটি আগে যাচাই করা হয়েছে।",
          show_alert: true
        });
        return;
      }

      if (data.startsWith("approve_")) {
        order.status = "approved";
        saveOrders();

        const links = order.selected.map(i => [{
          text: GROUPS[i].name + " — যোগ দিন",
          url: GROUPS[i].link
        }]);

        await bot.sendMessage(
          order.userId,
          "🎉 অভিনন্দন!\n\nআপনার পেমেন্ট সফলভাবে অনুমোদিত হয়েছে।\n\nআপনার মেম্বারশিপ সারা জীবনের জন্য। নিচের লিংকে চাপ দিয়ে নির্বাচিত গ্রুপগুলোতে যোগদানের অনুরোধ পাঠান।",
          { reply_markup: { inline_keyboard: links } }
        );

        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );

        await bot.answerCallbackQuery(query.id, {
          text: "পেমেন্ট অনুমোদিত হয়েছে।"
        });
      } else {
        order.status = "rejected";
        saveOrders();

        await bot.sendMessage(
          order.userId,
          "দুঃখিত! আপনার পেমেন্ট যাচাই করা যায়নি।\n\nঅনুগ্রহ করে অ্যাডমিনের সঙ্গে যোগাযোগ করুন।"
        );

        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );

        await bot.answerCallbackQuery(query.id, {
          text: "পেমেন্ট বাতিল করা হয়েছে।"
        });
      }
    }
  } catch (error) {
    console.error(error);
    await bot.answerCallbackQuery(query.id, {
      text: "সমস্যা হয়েছে। আবার চেষ্টা করুন।"
    }).catch(() => {});
  }
});

bot.on("message", async (msg) => {
  if (!msg.from || msg.from.is_bot) return;
  if (msg.text && msg.text.startsWith("/")) return;

  const state = users.get(msg.chat.id);
  if (!state) return;

  try {
    if (state.step === "proof_text" && msg.text) {
      const proof = msg.text.trim();
      if (proof.length < 4 || proof.length > 100) {
        return bot.sendMessage(msg.chat.id, "সঠিক ট্রানজেকশন আইডি লিখে পাঠান।");
      }
      await createOrder(msg.from, "ট্রানজেকশন আইডি", proof);
    }

    else if (state.step === "proof_last" && msg.text) {
      const proof = msg.text.trim();
      if (!/^\d{4}$/.test(proof)) {
        return bot.sendMessage(msg.chat.id, "শুধু শেষ 4 ডিজিট লিখুন।");
      }
      await createOrder(msg.from, "শেষ 4 ডিজিট", proof);
    }

    else if (state.step === "proof_photo" && msg.photo) {
      const photo = msg.photo[msg.photo.length - 1].file_id;
      await createOrder(msg.from, "স্ক্রিনশট", photo);
    }
  } catch (error) {
    console.error(error);
    await bot.sendMessage(msg.chat.id, "দুঃখিত, সমস্যা হয়েছে। আবার চেষ্টা করুন।");
  }
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});

console.log("Premium Membership Bot চালু হয়েছে।");
