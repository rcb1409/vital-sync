const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_KEY");
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }, {
  baseUrl: "https://gateway.helicone.ai",
  customHeaders: {
    "Helicone-Auth": `Bearer sk-helicone-7h6muay-werusjy-rhcej6i-qj4eery`
  }
});
model.generateContent("hello").then(res => console.log("SUCCESS:", res.response.text())).catch(err => console.error("ERROR:", err));
