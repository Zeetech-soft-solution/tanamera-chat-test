// Try it: node example.mjs "how many customers do we have?"
import { askNoviz } from "./noviz.mjs";

const answer = await askNoviz(process.argv[2] || "how many customers do we have?");
console.log(answer.reply);
