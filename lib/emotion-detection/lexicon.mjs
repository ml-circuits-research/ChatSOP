/** Symbolic lexicons and patterns of the EmotionDetectionSystem (DS029), English and Romanian.
 *
 * Every entry is {kind, label, pattern, score, position?} where `pattern` is a regular-expression source written in
 * folded form (lower case, no diacritics: "mulțumesc" is "multumesc"), matched with word boundaries by
 * ./strategies/symbolic.mjs. `position` is "start" (the match opens a sentence), "end" (nothing but punctuation or
 * emoji follows) or absent. The lists are original compilations by the project; no third-party word list or
 * licensed resource was copied (DS014 "Model weights", EmotionDetectionSystem lexicons), so nothing here carries an
 * external licence. `score` is a prior in (0, 1]: how likely a hit is a true signal of its kind.
 */
const rule = (kind, label, pattern, score, position) => ({kind, label, pattern, score, ...(position ? {position} : {})});

export const RULES = Object.freeze([
  // Courtesy.
  rule('greeting', 'hello', "(?:hi|hello|hey|hiya|howdy|greetings|good (?:morning|afternoon|evening|day))(?: there| all| everyone| team)?", 0.9, 'start'),
  rule('greeting', 'salut', "(?:salut|buna(?: ziua| dimineata| seara)?|servus|neata|noroc|hei|alo)", 0.9, 'start'),
  rule('closing', 'bye', "(?:bye(?:[ -]bye)?(?: for now)?|goodbye|good night|see you(?: later| soon| tomorrow)?|talk (?:to you )?later|bye for now|take care|have a (?:nice|good|great|lovely) (?:day|evening|weekend|one)|that'?s all(?: for now)?|that is all(?: for now)?|cheers|ttyl)", 0.85, 'end'),
  rule('closing', 'la revedere', "(?:la revedere|pa(?: pa)?|noapte buna|o zi buna|toate bune|cu bine|numai bine|ne auzim|ne vedem|asta e tot|atat deocamdata)", 0.85, 'end'),
  rule('thanks', 'thank', "(?:thank you|thanks|thx|thankyou|many thanks|much appreciated|i appreciate (?:it|that|your)|cheers for)(?: so much| very much| a lot| a million| again| in advance)?", 0.95),
  rule('thanks', 'multumesc', "(?:multumesc|multumim|mersi|merci|multam|va multumesc|iti multumesc|multumiri)(?: mult| frumos| din suflet| anticipat| tare)?", 0.95),
  rule('apology', 'sorry', "(?:sorry|i apologi[sz]e|my apologies|apologies|pardon me|excuse me|my bad|forgive me|sorry to bother)", 0.9),
  rule('apology', 'scuze', "(?:scuze|scuzati|scuza-ma|scuzati-ma|imi pare rau|iertare|ierta-ma|pardon)", 0.9),
  rule('politeness', 'please', "(?:please|kindly|would you mind|could you please|(?:could|would) you|pls|plz|if you don'?t mind|if you do not mind|would you be so kind|may i ask|if possible|i would like to ask|i'?d like to ask)", 0.85),
  rule('politeness', 'va rog', "(?:va rog|te rog|pls|plz|va rugam|as aprecia|daca se poate|daca nu va deranjeaza|daca nu te deranjeaza|am o rugaminte|ati putea|ai putea sa|ar fi posibil)", 0.85),
  // Urgency.
  rule('urgency', 'asap', "(?:asap|as soon as possible|urgent(?:ly)?|right now|immediately|at once|right away|hurry(?: up)?|quickly|emergency|in a hurry|this instant|quick (?:q|question|thing|one)|help me|help!|time[- ]sensitive|before the deadline|the deadline is)", 0.8),
  rule('urgency', 'urgent', "(?:urgent|de urgenta|ajutor+|repede|intrebare rapida|imediat|cat mai repede|chiar acum|grabnic|numaidecat|neintarziat|se grabeste|ne grabim|ma grabesc)", 0.8),
  // Uncertainty and emphasis.
  rule('hedge', 'think', "(?:ipotetic|hypothetically|in theory|i think|i guess|i suppose|i believe|i assume|maybe|perhaps|probably|possibly|presumably|apparently|supposedly|allegedly|not sure|i'?m not sure|i am not sure|it seems(?: that)?|seems like|as far as i know|if i remember (?:correctly|right)|i could be wrong|might be|not certain)", 0.8),
  rule('hedge', 'cred', "(?:cred ca|presupun(?: ca)?|(?<=^|[,;.!?] ?)poate|probabil|parca|mi se pare(?: ca)?|nu sunt sigur(?:a)?|se pare ca|din cate stiu|aparent|oarecum|as zice(?: ca)?|daca imi amintesc bine|s-ar putea|nu stiu sigur)", 0.8),
  rule('emphasis', 'intensifier', "(?:absolutely|totally|extremely|definitely|seriously|really really|so so|literally|by far|at all costs)", 0.6),
  rule('emphasis', 'intensificator', "(?:absolut|extrem de|foarte foarte|chiar chiar|categoric|neaparat|cu siguranta|serios)", 0.55),
  // Offence.
  rule('profanity', 'swear', "(?:fuck(?:ing|ed|er|ers|s|ed up)?|shit(?:ty|s)?|bullshit|goddamn(?:ed)?|damn(?:ed|it)?|crap(?:py)?|bloody hell|what the hell|the hell|wtf|wth|screw (?:this|it|you)|piss(?:ed off|ing)?|bastard|asshole|dickhead)", 0.9),
  rule('profanity', 'injuratura', "(?:dracu|dracului|naiba|naibii|pizda|pula|muie|cacat|rahat|belea|futu-i|futu-te|mama dracului|ma-sii|pe naiba|la dracu)", 0.9),
  rule('offensive', 'insult', "(?:(?:you(?:'re| are| r)?|u r|ur) (?:so |such an? |a |an |really )?(?:idiot|stupid|dumb|moron(?:ic)?|useless|pathetic|worthless|incompetent|clueless|a joke|trash|garbage)|shut up|you suck|stupid (?:bot|machine|thing|program|assistant)|useless (?:bot|machine|thing|program|assistant)|piece of (?:junk|trash|garbage))", 0.85),
  rule('offensive', 'insulta', "(?:esti (?:un |o )?(?:prost|proasta|idiot|idioata|inutil|inutila|nesimtit|cretin|handicapat|jalnic|incompetent)|prostule|idiotule|taci din gura|taci|boule|mizerabilule|bot prost|inutilule)", 0.85),
  // Affect.
  rule('frustration', 'ugh', "(?:ugh+|argh+|grr+|aargh|come on(?=[!,.?]|$)|not again|again\\?|this is (?:so |really |getting )?(?:annoying|frustrating|ridiculous|absurd|useless|maddening)|(?:still|yet) (?:not|doesn'?t|isn'?t|won'?t|can'?t)|why (?:won'?t|doesn'?t|isn'?t|can'?t) (?:it|this)|for the (?:third|fourth|fifth|last|nth|umpteenth) time|how many times|i (?:already|just) (?:told|said|asked|wrote)|fed up|sick (?:of|and tired of) (?:this|it)|tired of (?:this|it)|enough already|seriously\\?|what is wrong with (?:this|you)|unacceptable|calm down|thanks for nothing|this is (?:bullshit|crap)|what the (?:hell|fuck)|the fuck|damn it|again the same)", 0.8),
  rule('frustration', 'iar', "(?:iar\\?|iar si iar|nu mai pot|am mai (?:spus|zis|intrebat|scris)|pana cand|m-am saturat|enervant|exasperant|iar nu merge|tot nu merge|si tot nu|pff+|aoleu|te-am mai intrebat|ce naiba se intampla|nu se mai termina|la dracu|ce naiba|inacceptabil|calmeaza-te)", 0.75),
  rule('anger', 'angry', "(?:i(?:'m| am) (?:so |really |very )?(?:angry|furious|mad|livid|outraged|pissed)|furious|outrageous|unacceptable|how dare you|infuriating|i hate (?:this|it|that|you)|this is a (?:scam|disgrace|joke)|disgusting|rage)", 0.8),
  rule('anger', 'furios', "(?:sunt (?:foarte |atat de )?(?:furios|furioasa|nervos|nervoasa|suparat|suparata|iritat)|inacceptabil|revoltator|scandalos|ma enerveaza|urasc|cum indraznesti|dezgustator|ma scoate din minti)", 0.8),
  rule('confusion', 'confused', "(?:i(?:'m| am) (?:so |really |very |totally )?confused|i (?:don'?t|do not) (?:understand|get (?:it|this|what))|doesn'?t make (?:any )?sense|what do you mean|huh\\??|i(?:'m| am) not following|makes no sense|no idea what|i can'?t make sense|what\\?\\?+|that'?s confusing|this is confusing)", 0.85),
  rule('confusion', 'confuz', "(?:nu (?:am )?inteles|nu inteleg|sunt (?:foarte |complet )?confuz(?:a)?|ce vrei sa spui|cum adica|nu are sens|nu pricep|ma pierd|nu ma prind|nu e clar pentru mine|ce vrei sa zici)", 0.85),
  rule('curiosity', 'curious', "(?:i(?:'m| am) (?:so |really |very |just )?(?:curious|wondering)|i wonder|just curious|out of curiosity|how come|i was wondering|i(?:'d| would) love to know|fun fact|just wondering)", 0.8),
  rule('curiosity', 'curios', "(?:sunt (?:foarte |tare |doar )?curios(?:a)?|ma intreb|din curiozitate|ma intrebam|as vrea sa stiu|mi-ar placea sa aflu|oare)", 0.75),
  rule('joy', 'happy', "(?:yay+|hooray|woo+hoo+|awesome|great news|so happy|i(?:'m| am) (?:so |really |very )?(?:happy|glad|thrilled|delighted|excited)|i love (?:this|it|that)|love it|wonderful|fantastic|amazing|excellent|brilliant|congrat(?:s|ulations)|lol|haha+|hehe+|lmao|can'?t wait|that'?s great|this is great|well done)", 0.75),
  rule('joy', 'fericit', "(?:ura+|sunt (?:foarte |tare |atat de )?(?:fericit|fericita|bucuros|bucuroasa|multumit|multumita|incantat|incantata)|minunat|grozav|extraordinar|excelent|felicitari|abia astept|ma bucur|genial|e super|este super|imi place enorm|bravo)", 0.7),
  rule('sadness', 'sad', "(?:i(?:'m| am) (?:so |really |very |feeling )?(?:sad|depressed|heartbroken|devastated|crying|lonely|down)|i feel (?:sad|down|alone|hopeless)|my (?:father|mother|dad|mom|mum|grandmother|grandfather|friend|dog|cat|wife|husband) (?:died|passed away|has passed|just died)|i miss (?:him|her|you|them|home)|heartbreaking|so sad)", 0.8),
  rule('sadness', 'trist', "(?:sunt (?:foarte |tare |atat de )?(?:trist|trista|deprimat|deprimata|singur|singura|distrus|distrusa)|mi-e dor|mi-e tare greu|mi-a murit|a murit (?:tatal|mama|bunicul|bunica|cainele|pisica)|plang|ma simt (?:trist|singur|rau)|inima franta)", 0.8),
  rule('fear', 'scared', "(?:i(?:'m| am) (?:so |really |very |extremely )?(?:scared|terrified|worried|anxious|nervous|panicking|petrified|afraid of)|(?:very|so|really) afraid|scary|terrifying|freaking out|panic|what if (?:i|something|it|they) (?:go|goes|fail|fails|lose|lost|get|gets|can'?t|breaks|break))", 0.8),
  rule('fear', 'frica', "(?:mi-e (?:frica|teama)|am (?:o )?frica|sunt (?:foarte |tare )?(?:speriat|speriata|ingrijorat|ingrijorata|anxios|anxioasa|ingrozit)|ma tem|imi fac griji|panica|ajutor+|ajutati-ma|socorro|ma sperie)", 0.8),
  rule('disappointment', 'disappointed', "(?:disappoint(?:ed|ing|ment)|let (?:me|us|him|her) down|let down|what a pity|too bad|that'?s a shame|what a shame|bummer|i expected (?:more|better)|not what i expected|expected more|so much for)", 0.8),
  rule('disappointment', 'dezamagit', "(?:dezamagit(?:a)?|dezamagitor|dezamagire|ce pacat|pacat|ma asteptam la mai mult|ma asteptam la mai bine|nu e ce ma asteptam|m-ai dezamagit|nu asa ma asteptam)", 0.8),
  // Irony: soft by design (DS029); never above 0.55.
  rule('irony_possible', 'sarcasm', "(?:yeah,? right|oh,? (?:great|wonderful|perfect|fantastic|sure|brilliant|how nice)|as if|what a surprise|big surprise|thanks for nothing|great,? just great|nice going|nice job,? (?:genius|really)|how (?:original|helpful|nice of you)|sure,? because|and they say|(?:^|\\s)/s\\b|no kidding|real helpful|good luck with that)", 0.5),
  rule('irony_possible', 'ironie', "(?:da,? sigur|normal ca|ce surpriza|bravo,? ai reusit|foarte bine,? zau|mersi mult de tot|cum sa nu|ce sa spun,? genial|bravo tie|ce minune)", 0.5),
  // Discourse.
  rule('topic_shift', 'btw', "(?:by the way|btw|anyway|anyhow|on another note|on a different note|changing the subject|speaking of|moving on|incidentally|one more thing|another question|next question|oh and|one last thing|a different question|now,|unrelated,?)", 0.8, 'start'),
  rule('topic_shift', 'apropo', "(?:apropo|a propos|oricum|in alta ordine de idei|alta intrebare|inca ceva|si inca ceva|pe de alta parte|sa schimbam subiectul|de altfel|si apropo|ultima intrebare|intr-o alta ordine)", 0.8, 'start'),
  // Tag questions: a statement closed by a confirmation request.
  rule('confirmation_request', 'tag', ",\\s*(?:right|correct|yes|no|ok|okay|innit|eh|am i right|you know|isn'?t that so|is that right|is that correct)\\s*\\?", 0.9),
  rule('confirmation_request', 'tag_aux', ",\\s*(?:isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|hasn'?t|haven'?t|hadn'?t|can'?t|couldn'?t|won'?t|wouldn'?t|shouldn'?t|is|are|was|were|do|does|did|has|have|will|would|can|could|should|am)\\s+(?:it|he|she|they|we|you|i|there|that|this)\\s*\\?", 0.85),
  rule('confirmation_request', 'tag_ro', ",\\s*(?:nu|nu-i asa|asa e|corect|da|exact|nu-i|n-asa|asa|ok|sigur)\\s*\\?", 0.8),
]);

/** Emoji and emoticon signals (matched on the original text). */
export const EMOJI = Object.freeze([
  {kind: 'joy', label: 'smile', pattern: "(?:[\\u{1F600}-\\u{1F606}\\u{1F60A}\\u{1F642}\\u{1F389}\\u{1F973}\\u{2764}\\u{1F44D}]|(?<![\\w])[:;]-?[)D](?![\\w]))", score: 0.8},
  {kind: 'sadness', label: 'sad_face', pattern: "(?:[\\u{1F622}\\u{1F62D}\\u{1F61E}\\u{1F614}]|(?<![\\w])[:;]-?\\((?![\\w]))", score: 0.8},
  {kind: 'anger', label: 'angry_face', pattern: "[\\u{1F620}\\u{1F621}\\u{1F92C}\\u{1F624}]", score: 0.85},
  {kind: 'fear', label: 'fear_face', pattern: "[\\u{1F628}\\u{1F630}\\u{1F631}]", score: 0.8},
  {kind: 'confusion', label: 'confused_face', pattern: "[\\u{1F615}\\u{1F914}\\u{1F937}]", score: 0.7},
  {kind: 'irony_possible', label: 'eye_roll', pattern: "[\\u{1F644}\\u{1F612}\\u{1F643}]", score: 0.5},
  {kind: 'frustration', label: 'frustrated_face', pattern: "[\\u{1F626}\\u{1F629}\\u{1F62B}\\u{1F624}]", score: 0.7},
]);

/** Acronyms and initialisms that an all-caps word must not be mistaken for emphasis. */
export const ACRONYMS = Object.freeze(new Set(['NASA', 'NATO', 'FBI', 'CIA', 'USA', 'UK', 'EU', 'UN', 'API', 'CPU', 'GPU', 'SQL', 'HTML', 'JSON', 'XML', 'PDF', 'URL', 'HTTP', 'HTTPS', 'ID', 'OK', 'TV', 'PC', 'AI', 'ML', 'LLM', 'CEO', 'CTO', 'PhD', 'SRL', 'SA', 'RON', 'EUR', 'USD', 'GDP', 'DNA', 'RNA', 'IBM', 'SOP', 'UD', 'GPS', 'ASAP', 'ECG', 'MRI', 'ICU', 'VAT', 'TVA', 'CNP', 'ER']));
