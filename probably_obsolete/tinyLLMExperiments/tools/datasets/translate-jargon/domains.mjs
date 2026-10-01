/** Domains, flavours and styles of the translate-jargon-v1 generator (DS008 "translate-jargon", owner approval of 2026-10-01). */
export const DOMAINS = ['software development', 'devops and cloud', 'mobile apps', 'video games', 'esports and streaming', 'stock trading and crypto', 'banking and fintech', 'e-commerce and online shopping', 'digital marketing and SEO', 'social media and influencers', 'HR and recruiting', 'agile project management', 'medicine and pharmacy', 'fitness and gym', 'nutrition and diets', 'legal and contracts', 'real estate', 'construction and renovation', 'cars and car repair', 'aviation and travel', 'logistics and shipping', 'music production and DJs', 'film and video editing', 'photography', 'fashion and beauty', 'cooking and restaurants', 'football and sports betting', 'PC hardware and building computers', 'networking and telecom', 'cybersecurity', 'data science and machine learning', 'education and e-learning', 'startups and venture capital', 'accounting and taxes', 'customer support and call centers', 'manufacturing and industry', 'agriculture and agritech', 'hotels and tourism', 'solar energy and electric cars', '3D printing and DIY makers', 'academic research and publishing', 'smartphones and gadgets'];
export const FLAVOURS = ['English loanwords that Romanian speakers use unchanged in everyday speech about the domain (nouns, verbs, adjectives)', 'acronyms, tool and product names, protocols, file formats and units written as people type them (some in capitals, some with digits or dots)', 'slang, informal workplace or community jargon and code-like tokens (identifiers, flags, paths, snake_case, camelCase, hashtags, version numbers)'];
export const STYLES = [
  'a quick chat message to a colleague, lower case, no diacritics, a few typos',
  'a long run-on stream of thought without punctuation, no diacritics',
  'a request to an AI assistant, informal, no diacritics',
  'a forum post asking for help, with some typos',
  'a short SMS-like message with abbreviations',
  'a polite semi-formal email sentence, with diacritics',
  'a question typed fast on a phone, missing diacritics, one typo',
  'a complaint or review about a product or service, emotional, no diacritics',
  'an instruction or short how-to explanation to a friend, mixed Romanian and English',
  'a heavily code-switched message where English words sit inside Romanian grammar (Romanian endings on English words such as "deploy-ul", "am commituit")',
  'a status update to a team, informal, a few typos',
  'a message that puts the jargon term in double quotes inside the Romanian sentence',
  'a message that mentions a file name, command, URL fragment or version number',
  'a message from someone who writes Romanian with diacritics but mixes in English technical words',
];
export const LENGTHS = [['short, 6 to 14 words', 2], ['medium, 15 to 35 words', 4], ['long, 40 to 90 words', 2], ['very long run-on, 100 to 160 words', 1]];
