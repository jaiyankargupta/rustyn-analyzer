# Rustyn Analyzer

A Chrome extension that injects a custom complexity analysis button into LeetCode submission pages. It uses the Groq API to fetch time/space complexity and optimization suggestions for your code.

## Setup

1. **Load Unpacked**:
   - Go to `chrome://extensions/` in your browser
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** and select this directory

2. **Configure**:
   - Get a free API key from the [Groq Console](https://console.groq.com/)
   - Click the extension icon in Chrome and paste your key
   - Pick your preferred model and save

3. **Usage**:
   - Submit a solution on [LeetCode](https://leetcode.com/problems/)
   - Click the new **Analysis** button next to your runtime stats

