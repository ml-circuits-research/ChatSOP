/** Messages written for the EmotionDetectionSystem evaluation (DS023, experiment emotion-detection-v1): greetings,
 * thanks, apologies, urgency, hedges, swearing, irony, tag questions, discourse markers, strong feelings and neutral
 * controls, in English, Romanian and mixed. Written by the evaluating agent without labels; the labels come from the
 * judges. Original text, no source rights apply. */
export const HANDWRITTEN = [
  // English: courtesy and closing
  'Hello! Does Maria still work at Alpha Lab?', 'Good morning, could you tell me who manages the Delta Project?', 'Hey there, quick one: where is the ECG cart kept?',
  'Thanks, that helps. Now, who leads the choir?', 'Thank you so much for the answer, I really appreciate it.', 'Many thanks! Bye for now.',
  'Sorry to bother you again, but which town is Elif based in?', 'My apologies, I meant the other Sibiu. Does Ana live there?', 'Excuse me, is Nils a member of the Madrigal choir?',
  'Please tell me when the clinic opens.', 'Would you mind checking whether Jack manages Laura?', 'If you do not mind, which team does Karim belong to?',
  'Good night, see you tomorrow.', 'That is all for now, take care!', 'Cheers, talk to you later.',
  // English: urgency
  'I need the delivery address ASAP, the truck leaves in ten minutes.', 'Urgent: who is on call at the pharmacy right now?', 'Quickly, which gate is flight 220 leaving from?',
  'Hurry up, the deadline is in an hour and I still need the budget owner.', 'Please answer immediately: is the warehouse open today?', 'This is an emergency, where is the nearest defibrillator?',
  // English: hedges
  'I think Maria works at Alpha Lab.', 'Maybe Jack manages Laura, I am not sure.', 'Perhaps the meeting is on Tuesday?', 'It seems that Nils rents the blue van.',
  'I guess Ana lives in Cluj, but I could be wrong.', 'Probably the clinic opens at nine.', 'As far as I know, Karim leads the Delta Project.', 'Apparently the bakery closed last year.',
  // English: frustration / anger / disappointment
  'Ugh, again? Why does it still not show the schedule?', 'This is so frustrating, I already asked this three times!', 'Come on, I told you the name was Elif, not Elisa.',
  'I am furious, you got it wrong again.', 'This is unacceptable, the answer contradicts what I said a minute ago.', 'I expected better from this assistant, honestly.',
  'What a pity, I hoped the clinic would be open on Sunday.', 'I am disappointed, the list is still incomplete.', 'For the last time, Nils works at Alpha Lab!!',
  // English: confusion / curiosity
  'I am confused, what do you mean by "reports to"?', 'I do not understand why Ana appears twice in the answer.', 'Huh? That makes no sense.',
  'Just curious, how many people sing in the choir?', 'I wonder who founded the Madrigal choir.', 'Out of curiosity, what is the oldest building in Sibiu?',
  // English: joy / sadness / fear
  'Yay, the clinic is open on Sunday!', 'I am so happy, Ana got the job at Alpha Lab!', 'That is great news, congratulations to the whole team.',
  'I am so sad, my dog passed away this morning. Can you recommend a quiet park?', 'I feel lonely since I moved to Cluj; which clubs are nearby?',
  'I am scared that the exam results are wrong, who can check them?', 'I am really worried about the flood, which roads are closed?', 'Help me, I think I am lost, where is the station?',
  // English: profanity / offensive
  'What the hell is wrong with this schedule?', 'This is bullshit, Nils never worked there.', 'Damn it, the file is missing again.', 'Who the fuck approved this budget?',
  'You are useless, stupid bot, answer the question.', 'Shut up and just tell me the address.', 'You are an idiot, that is not what I asked.',
  // English: irony
  'Oh great, another meeting at seven in the morning.', 'Yeah right, the train is always on time.', 'Thanks for nothing, the answer was wrong.', 'Nice job, you managed to lose the whole list. Genius.',
  'Sure, because everybody loves waiting in line for two hours.', 'Wow, what a surprise, the printer is broken again.', 'Brilliant, just brilliant. Who moved my files?',
  // English: tag questions, discourse markers
  'Maria works at Alpha Lab, right?', 'Jack manages Laura, doesn\'t he?', 'The clinic opens at nine, correct?', 'Karim leads the Delta Project, no?', 'You are open on Sunday, aren\'t you?', 'Ana lives in Cluj, yes?',
  'By the way, who leads the choir?', 'Anyway, where were we? Which team does Karim belong to?', 'One more thing: is Nils a member of the choir?', 'On another note, when does the pharmacy close?', 'Speaking of the clinic, what are its opening hours?', 'Another question: who owns the blue van?',
  // English: emphasis / shouting
  'WHERE IS THE DELIVERY ADDRESS', 'Who manages the Delta Project?!', 'Is the warehouse open today??!', 'I really, really need to know who owns the van!!!', 'Pleeease tell me where the clinic is.',
  'Absolutely everyone must know who leads the choir.', 'Tell me NOW who approved the budget.',
  // English: neutral controls
  'Where does Ana work?', 'Who manages the Delta Project?', 'Is Nils a member of the Madrigal choir?', 'The warehouse closes at six on Fridays.', 'Karim leads the Delta Project and Jack manages Laura.',
  'How many people sing in the youth choir?', 'List the employees of Alpha Lab hired after 2020.', 'Which flights land in Cluj before noon?', 'Maria does not work at Beta Lab.', 'When did the clinic move to Strada Ulmilor?',
  'If Ana leaves Alpha Lab, who becomes the team lead?', 'Does the pharmacy deliver to Sibiu or only to Cluj?', 'Marie Curie died in 1934, and she won two Nobel Prizes.', 'The meeting is on Tuesday at nine.',
  // Romanian
  'Bună ziua! Ana mai lucrează la Alpha Lab?', 'Salut, cine conduce corul Madrigal?', 'Neața! Unde este căruciorul de ECG?', 'Mulțumesc mult pentru răspuns!', 'Mersi, mi-a fost de folos. Acum, cine conduce echipa Delta?',
  'Scuze de deranj, în ce oraș locuiește Elif?', 'Vă rog să-mi spuneți când se deschide clinica.', 'Te rog, verifică dacă Jack o conduce pe Laura.', 'Dacă nu vă deranjează, la ce echipă este Karim?', 'La revedere, ne auzim mâine!',
  'Am nevoie urgent de adresa de livrare, camionul pleacă imediat.', 'Repede, de la ce poartă pleacă zborul 220?', 'Este urgent: cine este de gardă la farmacie chiar acum?',
  'Cred că Maria lucrează la Alpha Lab.', 'Poate că Jack o conduce pe Laura, nu sunt sigur.', 'Probabil clinica se deschide la nouă.', 'Se pare că Nils închiriază duba albastră.', 'Din câte știu, Karim conduce proiectul Delta.',
  'Iar nu merge? De ce nu apare programul?', 'Nu mai pot, am întrebat deja de trei ori!', 'M-am săturat, ai greșit din nou.', 'Este inacceptabil, răspunsul contrazice ce am spus adineauri.', 'Ce păcat, speram că clinica e deschisă duminica.',
  'Sunt dezamăgit, lista tot nu e completă.', 'Nu înțeleg de ce apare Ana de două ori.', 'Cum adică "raportează către"? Sunt confuz.', 'Sunt curios câți oameni cântă în cor.', 'Mă întreb cine a înființat corul Madrigal.',
  'Ura, clinica e deschisă duminică!', 'Sunt foarte fericit, Ana a primit postul la Alpha Lab!', 'Mi-e frică de rezultatele examenului, cine le poate verifica?', 'Sunt trist, mi-a murit câinele azi dimineață.', 'Ajutor, m-am pierdut, unde e gara?',
  'Ce naiba se întâmplă cu programul ăsta?', 'La dracu, iar lipsește fișierul.', 'Ești un prost, nu asta am întrebat.', 'Taci și spune-mi adresa.', 'Ești complet inutil, bot prost.',
  'Da, sigur, trenul vine mereu la timp.', 'Bravo, ai reușit să pierzi toată lista.', 'Ce surpriză, imprimanta s-a stricat iar.',
  'Maria lucrează la Alpha Lab, nu-i așa?', 'Jack o conduce pe Laura, corect?', 'Clinica se deschide la nouă, da?', 'Apropo, cine conduce corul?', 'Încă ceva: Nils face parte din cor?', 'Oricum, în ce echipă este Karim?', 'Altă întrebare: cine deține duba albastră?',
  'CINE CONDUCE PROIECTUL DELTA', 'Cine conduce corul?!', 'Foarte, foarte urgent să aflu cine a aprobat bugetul!!!',
  'Unde lucrează Ana?', 'Cine conduce proiectul Delta?', 'Nils face parte din corul Madrigal?', 'Depozitul se închide la șase vineri.', 'Karim conduce proiectul Delta, iar Jack o conduce pe Laura.', 'Când s-a mutat clinica pe strada Ulmilor?',
  // Mixed and badly written
  'hi, unde lucrează Ana la Alpha Lab pls', 'thx mult, dar cine conduce corul ?', 'sorry, am uitat: Jack manages Laura, right?', 'ugh iar nu merge, why is the schedule empty',
  'hello!! cine e de gardă la farmacie asap', 'maybe Nils lucrează la Alpha, idk', 'btw cine conduce echipa Delta lol', 'omg ce naiba, again the same error?!', 'plz tell me când se deschide clinica',
  'i dont understand de ce apare Ana de doua ori', 'wher is the clinic, repede te rog', 'cred ca Maria works at Beta Lab, nu sunt sigur',
  'Tell me where Ana works. Thank you.', 'Where is the clinic? Thanks!', 'Who leads the choir? Sorry, I forgot to say hello.', 'Is the pharmacy open? (I hope so!)', 'Where is the station :( I am late',
  'So, who manages Laura?', 'Right, so who owns the van?', 'Well, I guess the clinic is closed on Sundays.', 'Honestly, I do not care who leads the choir, just tell me the budget.', 'Okay okay, calm down, just answer the question.',
  'Wow, that was fast, thanks!', 'Lol, that is a funny answer. Who leads the choir?', 'Hmm, that is not what I expected. Who approved the budget?',
];
