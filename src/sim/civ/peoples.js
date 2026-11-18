// Real peoples for World Map worlds: what a realm seeded from the real world
// (and every town and person that springs from it) is called, which of the
// game's four building styles it uses, and which pool its people's names
// come from. Square maps never use this file.
//
// Culture ids on a World Map are `${style}~${people}` (for example
// 'vale~japanese'; a people that grows from it later is 'vale~japanese~3'):
// everything keyed by the base style (buildings, banner colors, traits) reads
// the part before the first '~', and personName() reads the people after it.
//
// Names are common given names and family names of each language, put
// together at random; family names and given names that would recall a
// famous historical person were left out.

// Personal name pools: m and f are given names; s (or sm / sf where family
// names change with sex) are family names; order 'sf' puts the family name
// first (East Asian and Vietnamese use), 'f' gives a single name.
const POOLS = {
  ja: {
    order: 'sf',
    m: ['Haruto', 'Sota', 'Ren', 'Yuto', 'Riku', 'Kaito', 'Hinata', 'Minato', 'Takumi', 'Daiki', 'Kenta', 'Shota', 'Ryota', 'Yuma', 'Kosuke', 'Naoki', 'Tatsuya', 'Hiroki', 'Kazuki', 'Shun'],
    f: ['Yui', 'Hina', 'Mei', 'Sakura', 'Aoi', 'Rin', 'Yuna', 'Mio', 'Saki', 'Haruka', 'Nanami', 'Misaki', 'Ayaka', 'Emi', 'Kana', 'Natsuki', 'Riko', 'Honoka', 'Chihiro', 'Mayu'],
    s: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Yamazaki', 'Mori'],
  },
  zh: {
    order: 'sf',
    m: ['Jiahao', 'Haoran', 'Yuxuan', 'Junjie', 'Zhiwei', 'Mingyu', 'Tianyi', 'Yichen', 'Hongyu', 'Zhenyu', 'Wenbo', 'Jianhua', 'Xiaodong', 'Kaiwen', 'Bowen', 'Qiming', 'Yunfei', 'Zihao', 'Jinlong', 'Shengli'],
    f: ['Xinyi', 'Yutong', 'Zihan', 'Ruoxi', 'Mengyao', 'Jiayi', 'Shiyu', 'Yuqing', 'Xiaoling', 'Huimin', 'Lijuan', 'Wanting', 'Yanan', 'Siqi', 'Xueying', 'Meilin', 'Yiran', 'Jingwen', 'Chunhua', 'Lanying'],
    s: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Zhao', 'Huang', 'Zhou', 'Wu', 'Xu', 'Sun', 'Hu', 'Zhu', 'Gao', 'Lin', 'He', 'Guo', 'Luo', 'Zheng'],
  },
  // Taiwan: names in the romanization used there
  tw: {
    order: 'sf',
    m: ['Chih-wei', 'Chun-hao', 'Cheng-han', 'Yu-hsiang', 'Chia-hao', 'Po-wen', 'Tsung-han', 'Wei-ting', 'Chien-hung', 'Yu-cheng', 'Kuan-ting', 'Shih-chieh', 'Po-yu', 'Chih-hao', 'Yen-ting', 'Hsin-hung', 'Ming-hsun', 'Jui-lin', 'Tzu-hao', 'Kai-wen'],
    f: ['Yi-ting', 'Shu-fen', 'Ya-ting', 'Hsin-yi', 'Pei-shan', 'Yu-chen', 'Chia-hui', 'Mei-ling', 'Hui-wen', 'Ssu-yu', 'Yi-chun', 'Ting-yu', 'Ya-hui', 'Shu-ping', 'Pei-ju', 'Hsiao-wen', 'Chia-ying', 'Yu-ting', 'Wan-ju', 'Li-hua'],
    s: ['Chen', 'Lin', 'Huang', 'Chang', 'Lee', 'Wang', 'Wu', 'Liu', 'Tsai', 'Yang', 'Hsu', 'Cheng', 'Hsieh', 'Kuo', 'Hung', 'Chiu', 'Tseng', 'Liao', 'Lai', 'Chou'],
  },
  ko: {
    order: 'sf',
    m: ['Ji-hoon', 'Min-jun', 'Seo-jun', 'Do-yun', 'Ha-joon', 'Joon-ho', 'Hyun-woo', 'Sung-min', 'Jae-won', 'Dong-hyun', 'Woo-jin', 'Tae-yang', 'Sang-hoon', 'Young-ho', 'Kyung-soo', 'Jin-woo', 'Seung-ho', 'Jun-young', 'Chan-woo', 'Hyeon-su'],
    f: ['Seo-yeon', 'Ji-woo', 'Ha-eun', 'Min-seo', 'Su-ah', 'Ye-jin', 'Eun-ji', 'Hye-jin', 'Soo-jin', 'Da-eun', 'Yu-jin', 'Ga-eun', 'Mi-rae', 'Hae-won', 'Bo-ra', 'Ji-hye', 'Eun-seo', 'Seo-hyun', 'Ye-rin', 'Chae-won'],
    s: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Yoo', 'Hong'],
  },
  mn: {
    order: 'f',
    m: ['Bat-Erdene', 'Ganbold', 'Tumur', 'Bold', 'Munkh-Ochir', 'Batbayar', 'Sukhbat', 'Temuulen', 'Altangerel', 'Bayarsaikhan', 'Ganzorig', 'Erdenebold'],
    f: ['Oyuntsetseg', 'Narantuya', 'Enkhjargal', 'Saruul', 'Altantsetseg', 'Sarangerel', 'Bolormaa', 'Tsetsegmaa', 'Ariunaa', 'Khulan', 'Nomin', 'Undral'],
  },
  vi: {
    order: 'sf',
    m: ['Minh Quan', 'Duc Anh', 'Gia Huy', 'Hoang Nam', 'Quoc Bao', 'Thanh Tung', 'Van Long', 'Huu Phuoc', 'Tuan Kiet', 'Bao Long', 'Dinh Khoa', 'Trung Hieu'],
    f: ['Ngoc Anh', 'Thu Trang', 'Minh Chau', 'Phuong Linh', 'Thanh Huong', 'Bao Ngoc', 'Lan Anh', 'Thuy Duong', 'Kim Ngan', 'Hai Yen', 'Mai Phuong', 'Khanh Linh'],
    s: ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Phan', 'Vu', 'Dang', 'Bui', 'Do', 'Ngo', 'Duong', 'Ly', 'Trinh'],
  },
  th: {
    m: ['Somchai', 'Anan', 'Kittisak', 'Prasert', 'Thanawat', 'Wichai', 'Narong', 'Sakda', 'Chaiwat', 'Pichit', 'Surasak', 'Arthit'],
    f: ['Anong', 'Malee', 'Siriporn', 'Kanya', 'Pranee', 'Nittaya', 'Ratana', 'Sumalee', 'Wanida', 'Chalida', 'Kamon', 'Duangjai'],
    s: ['Srisuk', 'Wongsakul', 'Chaiyaporn', 'Saetang', 'Boonmee', 'Phromma', 'Thongdee', 'Suksawat', 'Rattanakorn', 'Kaewmanee', 'Inthasorn', 'Jaidee'],
  },
  ms: {
    m: ['Budi', 'Ahmad', 'Agus', 'Hafiz', 'Rizal', 'Bayu', 'Dimas', 'Faisal', 'Hendra', 'Irfan', 'Wahyu', 'Arif'],
    f: ['Siti', 'Dewi', 'Nurul', 'Ayu', 'Putri', 'Rina', 'Sari', 'Indah', 'Aisyah', 'Fitri', 'Wulan', 'Lestari'],
    s: ['Santoso', 'Wijaya', 'Hidayat', 'Saputra', 'Kusuma', 'Rahman', 'Hassan', 'Pratama', 'Setiawan', 'Halim', 'Ismail', 'Nugroho'],
  },
  hi: {
    m: ['Arjun', 'Rohan', 'Vikram', 'Aarav', 'Karan', 'Amit', 'Sanjay', 'Vivek', 'Anil', 'Deepak', 'Nikhil', 'Ravi', 'Suresh', 'Aditya'],
    f: ['Priya', 'Ananya', 'Kavya', 'Neha', 'Pooja', 'Sunita', 'Meera', 'Divya', 'Lakshmi', 'Asha', 'Shreya', 'Radha', 'Anjali', 'Kiran'],
    s: ['Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Reddy', 'Iyer', 'Nair', 'Joshi', 'Mehta', 'Rao', 'Desai', 'Kulkarni', 'Chauhan'],
  },
  ur: {
    m: ['Ali', 'Bilal', 'Faisal', 'Hamza', 'Kamran', 'Nadeem', 'Omar', 'Rashid', 'Saad', 'Tariq', 'Usman', 'Zubair'],
    f: ['Ayesha', 'Fatima', 'Hina', 'Maryam', 'Nadia', 'Rabia', 'Saba', 'Sana', 'Zainab', 'Amna', 'Farah', 'Mehwish'],
    s: ['Qureshi', 'Malik', 'Chaudhry', 'Siddiqui', 'Rana', 'Mirza', 'Ansari', 'Baig', 'Sheikh', 'Rahman', 'Haque', 'Awan'],
  },
  bo: {
    order: 'f',
    m: ['Tenzin', 'Dorji', 'Karma', 'Sonam', 'Tshering', 'Kinley', 'Dawa', 'Ugyen', 'Norbu', 'Ngawang', 'Tashi', 'Phuntsho'],
    f: ['Pema', 'Yangchen', 'Choden', 'Deki', 'Dechen', 'Lhamo', 'Kunzang', 'Dolma', 'Zangmo', 'Wangmo', 'Sonam', 'Tshering'],
  },
  ca: {
    m: ['Nurlan', 'Aibek', 'Rustam', 'Bakhyt', 'Daniyar', 'Yerlan', 'Azamat', 'Bekzat', 'Timur', 'Sanjar', 'Murat', 'Ulugbek'],
    f: ['Aigerim', 'Dilnoza', 'Madina', 'Gulnara', 'Aizhan', 'Saule', 'Zarina', 'Nilufar', 'Asel', 'Kamila', 'Dinara', 'Malika'],
    sm: ['Abenov', 'Seitkaliev', 'Nazarov', 'Tursunov', 'Omarov', 'Bekov', 'Sultanov', 'Iskakov', 'Rakhimov', 'Yusupov', 'Ermekov', 'Saparov'],
    sf: ['Abenova', 'Seitkalieva', 'Nazarova', 'Tursunova', 'Omarova', 'Bekova', 'Sultanova', 'Iskakova', 'Rakhimova', 'Yusupova', 'Ermekova', 'Saparova'],
  },
  fa: {
    m: ['Dariush', 'Kaveh', 'Arash', 'Babak', 'Farhad', 'Kamran', 'Mehdi', 'Omid', 'Siavash', 'Behrouz', 'Navid', 'Ramin'],
    f: ['Shirin', 'Parisa', 'Mahsa', 'Nasrin', 'Roya', 'Leila', 'Ladan', 'Sara', 'Yasaman', 'Mina', 'Golnaz', 'Azadeh'],
    s: ['Karimi', 'Hosseini', 'Rahimi', 'Ahmadi', 'Mousavi', 'Jafari', 'Sadeghi', 'Tehrani', 'Rostami', 'Bahrami', 'Moradi', 'Kazemi'],
  },
  ar: {
    m: ['Omar', 'Khalid', 'Youssef', 'Karim', 'Tariq', 'Samir', 'Nabil', 'Hassan', 'Faris', 'Rami', 'Walid', 'Ziad', 'Adel', 'Bassam'],
    f: ['Layla', 'Noor', 'Amira', 'Salma', 'Rania', 'Huda', 'Yasmin', 'Mariam', 'Dina', 'Hana', 'Lina', 'Samira', 'Reem', 'Nadia'],
    s: ['Haddad', 'Khoury', 'Mansour', 'Saleh', 'Hamdan', 'Farouk', 'Aziz', 'Najjar', 'Rahal', 'Sabbagh', 'Qasim', 'Bakri', 'Shami', 'Masri'],
  },
  tr: {
    m: ['Emre', 'Mehmet', 'Burak', 'Can', 'Kerem', 'Murat', 'Onur', 'Serkan', 'Tolga', 'Volkan', 'Yusuf', 'Barış'],
    f: ['Ayşe', 'Elif', 'Zeynep', 'Merve', 'Selin', 'Deniz', 'Esra', 'Gizem', 'Ebru', 'Derya', 'Leyla', 'Nur'],
    s: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Koç'],
  },
  he: {
    m: ['Avi', 'Eitan', 'Yonatan', 'Noam', 'Omer', 'Itai', 'Uri', 'Gil', 'Amir', 'Lior'],
    f: ['Noa', 'Tamar', 'Yael', 'Shira', 'Maya', 'Michal', 'Talia', 'Adi', 'Hila', 'Roni'],
    s: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Dahan', 'Friedman', 'Shapiro', 'Katz', 'Azoulay'],
  },
  ka: {
    m: ['Giorgi', 'Levan', 'Davit', 'Nikoloz', 'Irakli', 'Lasha', 'Zurab', 'Tornike', 'Luka', 'Sandro'],
    f: ['Nino', 'Tamar', 'Ana', 'Mariam', 'Ketevan', 'Salome', 'Nana', 'Eka', 'Tako', 'Natia'],
    s: ['Beridze', 'Kapanadze', 'Gelashvili', 'Lomidze', 'Maisuradze', 'Tsiklauri', 'Chikhladze', 'Mamedashvili', 'Gogoladze', 'Abashidze'],
  },
  hy: {
    m: ['Aram', 'Armen', 'Tigran', 'Hayk', 'Gor', 'Narek', 'Davit', 'Vahe', 'Arman', 'Levon'],
    f: ['Ani', 'Narine', 'Lusine', 'Anahit', 'Mariam', 'Gayane', 'Silva', 'Hasmik', 'Nare', 'Lilit'],
    s: ['Petrosyan', 'Hakobyan', 'Sargsyan', 'Grigoryan', 'Harutyunyan', 'Vardanyan', 'Avetisyan', 'Karapetyan', 'Mkrtchyan', 'Ghazaryan'],
  },
  ru: {
    m: ['Aleksei', 'Dmitri', 'Ivan', 'Sergei', 'Andrei', 'Mikhail', 'Nikolai', 'Pavel', 'Oleg', 'Konstantin', 'Artyom', 'Maxim', 'Roman', 'Kirill'],
    f: ['Anna', 'Elena', 'Olga', 'Natalia', 'Tatiana', 'Irina', 'Svetlana', 'Yekaterina', 'Maria', 'Daria', 'Polina', 'Ksenia', 'Vera', 'Alina'],
    sm: ['Sokolov', 'Volkov', 'Morozov', 'Lebedev', 'Kozlov', 'Novikov', 'Pavlov', 'Orlov', 'Belov', 'Zaitsev', 'Fedorov', 'Gusev', 'Kuznetsov', 'Smirnov'],
    sf: ['Sokolova', 'Volkova', 'Morozova', 'Lebedeva', 'Kozlova', 'Novikova', 'Pavlova', 'Orlova', 'Belova', 'Zaitseva', 'Fedorova', 'Guseva', 'Kuznetsova', 'Smirnova'],
  },
  uk: {
    m: ['Oleksandr', 'Andriy', 'Mykola', 'Dmytro', 'Bohdan', 'Yaroslav', 'Serhiy', 'Vasyl', 'Ostap', 'Petro', 'Yuriy', 'Maksym'],
    f: ['Olena', 'Oksana', 'Iryna', 'Natalia', 'Kateryna', 'Halyna', 'Solomiya', 'Yulia', 'Tetiana', 'Daryna', 'Mariya', 'Lesya'],
    s: ['Kovalenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Melnyk', 'Boyko', 'Moroz', 'Lysenko', 'Marchenko', 'Savchenko', 'Rudenko', 'Polishchuk'],
  },
  pl: {
    m: ['Piotr', 'Tomasz', 'Krzysztof', 'Paweł', 'Michał', 'Marcin', 'Jakub', 'Kamil', 'Łukasz', 'Wojciech', 'Adam', 'Bartosz'],
    f: ['Anna', 'Katarzyna', 'Agnieszka', 'Magdalena', 'Joanna', 'Monika', 'Ewa', 'Zofia', 'Maja', 'Natalia', 'Aleksandra', 'Julia'],
    sm: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Zieliński', 'Szymański', 'Dąbrowski', 'Kozłowski', 'Mazur', 'Krawczyk', 'Jankowski'],
    sf: ['Nowak', 'Kowalska', 'Wiśniewska', 'Wójcik', 'Kamińska', 'Zielińska', 'Szymańska', 'Dąbrowska', 'Kozłowska', 'Mazur', 'Krawczyk', 'Jankowska'],
  },
  cs: {
    m: ['Jan', 'Petr', 'Tomáš', 'Martin', 'Jakub', 'Lukáš', 'Ondřej', 'Marek', 'Pavel', 'Jiří', 'Michal', 'Filip'],
    f: ['Jana', 'Eva', 'Tereza', 'Lucie', 'Kateřina', 'Veronika', 'Petra', 'Barbora', 'Markéta', 'Klára', 'Hana', 'Zuzana'],
    sm: ['Novák', 'Svoboda', 'Novotný', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec', 'Pokorný', 'Marek', 'Krejčí'],
    sf: ['Nováková', 'Svobodová', 'Novotná', 'Černá', 'Procházková', 'Kučerová', 'Veselá', 'Horáková', 'Němcová', 'Pokorná', 'Marková', 'Krejčí'],
  },
  balt: {
    m: ['Jonas', 'Tomas', 'Mantas', 'Lukas', 'Andris', 'Jānis', 'Mārtiņš', 'Darius', 'Rokas', 'Kārlis'],
    f: ['Rasa', 'Ieva', 'Laura', 'Agnė', 'Ilze', 'Līga', 'Inga', 'Austėja', 'Kristīne', 'Dace'],
    sm: ['Kazlauskas', 'Petrauskas', 'Jankauskas', 'Bērziņš', 'Kalniņš', 'Ozols', 'Vasiliauskas', 'Liepiņš'],
    sf: ['Kazlauskienė', 'Petrauskaitė', 'Jankauskienė', 'Bērziņa', 'Kalniņa', 'Ozola', 'Vasiliauskienė', 'Liepiņa'],
  },
  hu: {
    m: ['Bence', 'Máté', 'Levente', 'Gergő', 'Dávid', 'Ádám', 'Balázs', 'Zoltán', 'Tamás', 'László', 'Péter', 'Gábor'],
    f: ['Anna', 'Réka', 'Eszter', 'Zsófia', 'Katalin', 'Nóra', 'Dóra', 'Lili', 'Boglárka', 'Krisztina', 'Judit', 'Orsolya'],
    s: ['Nagy', 'Kovács', 'Tóth', 'Szabó', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp'],
  },
  ro: {
    m: ['Andrei', 'Mihai', 'Alexandru', 'Ionuț', 'Bogdan', 'Cristian', 'Florin', 'Radu', 'Adrian', 'Sorin', 'Dragoș', 'Tudor'],
    f: ['Ioana', 'Maria', 'Elena', 'Andreea', 'Alexandra', 'Cristina', 'Raluca', 'Mihaela', 'Diana', 'Irina', 'Bianca', 'Roxana'],
    s: ['Popescu', 'Ionescu', 'Popa', 'Dumitru', 'Stan', 'Stoica', 'Gheorghe', 'Matei', 'Ciobanu', 'Rusu', 'Munteanu', 'Constantin'],
  },
  sl: {
    m: ['Marko', 'Nikola', 'Stefan', 'Luka', 'Ivan', 'Milan', 'Dragan', 'Petar', 'Bojan', 'Goran', 'Dejan', 'Nemanja'],
    f: ['Ana', 'Jelena', 'Milica', 'Marija', 'Ivana', 'Katarina', 'Mila', 'Teodora', 'Sanja', 'Maja', 'Dragana', 'Vesna'],
    s: ['Petrović', 'Jovanović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović', 'Horvat', 'Kovačević', 'Babić', 'Ivanov', 'Dimitrov', 'Georgiev'],
  },
  sq: {
    m: ['Arben', 'Besnik', 'Driton', 'Ermal', 'Gentian', 'Ilir', 'Klodian', 'Luan', 'Altin', 'Dritan'],
    f: ['Elira', 'Ardita', 'Besa', 'Drita', 'Era', 'Jonida', 'Mirela', 'Teuta', 'Valbona', 'Blerta'],
    s: ['Krasniqi', 'Gashi', 'Morina', 'Kelmendi', 'Dervishi', 'Leka', 'Prifti', 'Basha', 'Duka', 'Hasani'],
  },
  el: {
    m: ['Giorgos', 'Dimitris', 'Nikos', 'Kostas', 'Yannis', 'Christos', 'Panagiotis', 'Vasilis', 'Thanos', 'Stavros', 'Manolis', 'Spyros'],
    f: ['Maria', 'Eleni', 'Katerina', 'Sofia', 'Georgia', 'Despina', 'Ioanna', 'Anna', 'Dimitra', 'Vasiliki', 'Christina', 'Athina'],
    sm: ['Papadopoulos', 'Georgiou', 'Nikolaou', 'Dimitriou', 'Konstantinou', 'Pappas', 'Vlachos', 'Antoniou', 'Makris', 'Ioannou'],
    sf: ['Papadopoulou', 'Georgiou', 'Nikolaou', 'Dimitriou', 'Konstantinou', 'Pappa', 'Vlachou', 'Antoniou', 'Makri', 'Ioannou'],
  },
  de: {
    m: ['Lukas', 'Jonas', 'Felix', 'Maximilian', 'Tobias', 'Florian', 'Matthias', 'Stefan', 'Johannes', 'Niklas', 'Moritz', 'Benedikt'],
    f: ['Anna', 'Lena', 'Sophie', 'Lea', 'Katharina', 'Julia', 'Laura', 'Hannah', 'Marie', 'Johanna', 'Clara', 'Franziska'],
    s: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Becker', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Wolf', 'Krämer', 'Lehmann'],
  },
  nl: {
    m: ['Daan', 'Sem', 'Bram', 'Thijs', 'Lars', 'Jesse', 'Ruben', 'Stijn', 'Pieter', 'Joris', 'Wouter', 'Sander'],
    f: ['Emma', 'Sanne', 'Lotte', 'Fleur', 'Anouk', 'Femke', 'Lieke', 'Eva', 'Iris', 'Marieke', 'Noor', 'Floor'],
    s: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'Bakker', 'Visser', 'Smit', 'Meijer', 'Mulder', 'de Boer', 'Peeters', 'Janssens'],
  },
  fr: {
    m: ['Lucas', 'Hugo', 'Louis', 'Mathis', 'Théo', 'Antoine', 'Julien', 'Mathieu', 'Nicolas', 'Pierre', 'Bastien', 'Olivier'],
    f: ['Camille', 'Léa', 'Chloé', 'Manon', 'Inès', 'Juliette', 'Margaux', 'Élise', 'Claire', 'Sophie', 'Amélie', 'Pauline'],
    s: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Laurent', 'Girard', 'Lefebvre', 'Fournier'],
  },
  en: {
    m: ['James', 'Oliver', 'Jack', 'Harry', 'Thomas', 'William', 'Samuel', 'Daniel', 'Henry', 'Ethan', 'Lucas', 'Owen', 'Ryan', 'Liam', 'Noah', 'Callum'],
    f: ['Olivia', 'Emily', 'Sophie', 'Grace', 'Chloe', 'Lucy', 'Hannah', 'Ella', 'Amelia', 'Jessica', 'Megan', 'Ruby', 'Isla', 'Abigail', 'Zoe', 'Molly'],
    s: ['Ashworth', 'Fletcher', 'Thornton', 'Whitaker', 'Barlow', 'Sutton', 'Holloway', 'Lambert', 'Pearce', 'Marsh', 'Hayward', 'Collins', 'Bennett', 'Foster', 'Griffin', 'Carver'],
  },
  it: {
    m: ['Marco', 'Luca', 'Matteo', 'Alessandro', 'Lorenzo', 'Andrea', 'Davide', 'Francesco', 'Giacomo', 'Simone', 'Riccardo', 'Stefano'],
    f: ['Giulia', 'Chiara', 'Francesca', 'Sara', 'Martina', 'Alessia', 'Elena', 'Valentina', 'Federica', 'Silvia', 'Beatrice', 'Laura'],
    s: ['Rossi', 'Russo', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Moretti'],
  },
  es: {
    m: ['Alejandro', 'Javier', 'Diego', 'Pablo', 'Daniel', 'Mateo', 'Santiago', 'Andrés', 'Sergio', 'Carlos', 'Miguel', 'Luis', 'Raúl', 'Tomás'],
    f: ['Lucía', 'María', 'Paula', 'Sofía', 'Valentina', 'Camila', 'Elena', 'Carmen', 'Isabel', 'Daniela', 'Laura', 'Ana', 'Gabriela', 'Marta'],
    s: ['García', 'Rodríguez', 'Martínez', 'López', 'González', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Morales', 'Vargas', 'Castillo'],
  },
  pt: {
    m: ['João', 'Pedro', 'Gabriel', 'Lucas', 'Rafael', 'Tiago', 'Miguel', 'Gustavo', 'Matheus', 'Rodrigo', 'André', 'Bruno'],
    f: ['Ana', 'Beatriz', 'Mariana', 'Inês', 'Juliana', 'Larissa', 'Camila', 'Fernanda', 'Leonor', 'Carolina', 'Letícia', 'Joana'],
    s: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Carvalho', 'Ribeiro', 'Rodrigues', 'Martins', 'Lopes', 'Gomes'],
  },
  nordic: {
    m: ['Erik', 'Lars', 'Anders', 'Magnus', 'Henrik', 'Johan', 'Olav', 'Sindre', 'Mikkel', 'Rasmus', 'Gustav', 'Emil'],
    f: ['Ingrid', 'Astrid', 'Sigrid', 'Karin', 'Elin', 'Freja', 'Maja', 'Linnea', 'Sofie', 'Ida', 'Nora', 'Hanna'],
    s: ['Hansen', 'Johansen', 'Larsen', 'Andersson', 'Nilsson', 'Lindqvist', 'Berg', 'Haugen', 'Dahl', 'Lund', 'Jensen', 'Nielsen', 'Bakke', 'Sundberg'],
  },
  fi: {
    m: ['Mikko', 'Juha', 'Antti', 'Ville', 'Janne', 'Matti', 'Eero', 'Lauri', 'Tuomas', 'Aleksi', 'Mart', 'Kristjan'],
    f: ['Aino', 'Helmi', 'Siiri', 'Eveliina', 'Johanna', 'Laura', 'Tiina', 'Kaisa', 'Riikka', 'Hanna', 'Kadri', 'Liis'],
    s: ['Korhonen', 'Virtanen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Tamm', 'Saar', 'Sepp'],
  },
  et: {
    m: ['Abebe', 'Dawit', 'Tesfaye', 'Yonas', 'Bereket', 'Henok', 'Mekonnen', 'Solomon', 'Biruk', 'Kidus', 'Elias', 'Getachew'],
    f: ['Tigist', 'Selam', 'Hiwot', 'Meron', 'Bethlehem', 'Liya', 'Rahel', 'Mahlet', 'Saba', 'Hana', 'Tsion', 'Yordanos'],
    s: ['Alemu', 'Bekele', 'Girma', 'Tadesse', 'Wolde', 'Kebede', 'Assefa', 'Desta', 'Lemma', 'Negash', 'Tefera', 'Ayele'],
  },
  sw: {
    m: ['Juma', 'Baraka', 'Amani', 'Otieno', 'Kamau', 'Mwangi', 'Omondi', 'Hamisi', 'Musa', 'Kiprono', 'Jabali', 'Faraji'],
    f: ['Neema', 'Wanjiru', 'Akinyi', 'Zawadi', 'Imani', 'Amina', 'Rehema', 'Furaha', 'Njeri', 'Achieng', 'Halima', 'Nyokabi'],
    s: ['Mwangi', 'Otieno', 'Kariuki', 'Njoroge', 'Ochieng', 'Mutua', 'Wekesa', 'Kimani', 'Massawe', 'Mollel', 'Mushi', 'Okello'],
  },
  waf: {
    m: ['Chinedu', 'Emeka', 'Kofi', 'Kwabena', 'Oluwaseun', 'Tunde', 'Ibrahim', 'Moussa', 'Mamadou', 'Yaw', 'Femi', 'Obinna'],
    f: ['Ngozi', 'Adaeze', 'Ama', 'Abena', 'Folake', 'Aminata', 'Fatou', 'Aïssatou', 'Chiamaka', 'Efua', 'Yetunde', 'Kemi'],
    s: ['Okafor', 'Mensah', 'Adeyemi', 'Diallo', 'Traoré', 'Boateng', 'Ndiaye', 'Asante', 'Coulibaly', 'Eze', 'Owusu', 'Bello', 'Sow', 'Okoro'],
  },
  saf: {
    m: ['Thabo', 'Sipho', 'Tendai', 'Kagiso', 'Lungile', 'Bongani', 'Tatenda', 'Mpho', 'Themba', 'Kabelo', 'Jabulani', 'Chanda'],
    f: ['Lindiwe', 'Chipo', 'Nomvula', 'Thandiwe', 'Naledi', 'Zanele', 'Ayanda', 'Rudo', 'Palesa', 'Mbali', 'Nandi', 'Tsitsi'],
    s: ['Dlamini', 'Ndlovu', 'Moyo', 'Banda', 'Phiri', 'Mokoena', 'Khumalo', 'Nkosi', 'Mutasa', 'Sithole', 'Mwale', 'Shange'],
  },
  mg: {
    m: ['Andry', 'Hery', 'Tiana', 'Mamy', 'Rivo', 'Faly', 'Haja', 'Tojo'],
    f: ['Fara', 'Lova', 'Voahangy', 'Hanta', 'Miora', 'Noro', 'Sitraka', 'Vola'],
    s: ['Rakoto', 'Rasoanaivo', 'Randria', 'Rabe', 'Razafy', 'Andriamanana', 'Rakotonirina', 'Ravelo'],
  },
  // the United States: common American names of many origins
  us: {
    m: ['Michael', 'Christopher', 'Matthew', 'Joshua', 'David', 'Andrew', 'Tyler', 'Brandon', 'Jacob', 'Ryan', 'Justin', 'Kevin', 'Austin', 'Logan', 'Mason', 'Carlos', 'Marcus', 'Dylan', 'Caleb', 'Nathan'],
    f: ['Jennifer', 'Ashley', 'Jessica', 'Sarah', 'Emily', 'Madison', 'Hannah', 'Taylor', 'Lauren', 'Megan', 'Rachel', 'Brittany', 'Samantha', 'Kayla', 'Allison', 'Avery', 'Maria', 'Destiny', 'Brooke', 'Natalie'],
    s: ['Miller', 'Davis', 'Anderson', 'Thompson', 'White', 'Martin', 'Garcia', 'Martinez', 'Robinson', 'Clark', 'Rodriguez', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'Hernandez', 'Wright', 'Hill', 'Scott', 'Green', 'Baker', 'Nelson', 'Mitchell', 'Roberts', 'Turner', 'Campbell', 'Parker', 'Evans', 'Collins', 'Stewart', 'Murphy', 'Cooper', 'Rivera', 'Kim', 'Nguyen', 'Patel', 'Sullivan', 'Brooks', 'Price'],
  },
  // French Canada
  qc: {
    m: ['Mathieu', 'Olivier', 'Gabriel', 'Félix', 'Samuel', 'Étienne', 'Alexandre', 'Simon', 'Maxime', 'Jérôme', 'Benoît', 'Philippe'],
    f: ['Émilie', 'Catherine', 'Geneviève', 'Isabelle', 'Marie-Ève', 'Julie', 'Audrey', 'Chloé', 'Camille', 'Valérie', 'Mélanie', 'Annie'],
    s: ['Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagné', 'Ouellet', 'Pelletier', 'Bélanger', 'Lévesque'],
  },
  ph: {
    m: ['Jose', 'Mark', 'John Paul', 'Angelo', 'Christian', 'Rommel', 'Jun', 'Paolo', 'Carlo', 'Jerome', 'Ramon', 'Nestor'],
    f: ['Maria', 'Kristine', 'Angelica', 'Jasmine', 'Mary Grace', 'Rowena', 'Joy', 'Cristina', 'Lea', 'Rosalinda', 'Analyn', 'Marites'],
    s: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Villanueva', 'Ramos', 'Castillo', 'Flores', 'dela Cruz', 'Navarro', 'Pascual'],
  },
  sg: {
    order: 'sf',
    m: ['Wei Ming', 'Jun Jie', 'Kai Xiang', 'Zhi Hao', 'Jia Wei', 'Wen Jie', 'Yong Sheng', 'Boon Kiat', 'Hong Wei', 'Jian Hui'],
    f: ['Hui Min', 'Li Ting', 'Xin Yi', 'Mei Ling', 'Shu Fen', 'Jia Hui', 'Wan Ting', 'Pei Shan', 'Siew Ling', 'Yu Xuan'],
    s: ['Tan', 'Lim', 'Lee', 'Ng', 'Ong', 'Goh', 'Chua', 'Koh', 'Teo', 'Wong', 'Chan', 'Yeo', 'Ho', 'Sim'],
  },
  kl: {
    m: ['Aputsiaq', 'Inuk', 'Malik', 'Kaali', 'Nuka', 'Hans', 'Pele', 'Minik'],
    f: ['Nivi', 'Aviaja', 'Paninnguaq', 'Naja', 'Ivalo', 'Pipaluk', 'Arnaq', 'Sika'],
    s: ['Kleist', 'Lynge', 'Petersen', 'Olsen', 'Berthelsen', 'Kristiansen', 'Jeremiassen', 'Heilmann'],
  },
};

// Peoples: descriptor, building style (the game's four: 'vale' timber and
// clay tile, 'dune' sandstone and flat roofs, 'frost' slate and steep roofs,
// 'mire' stilts and thatch) and name pool (a list mixes pools person by
// person: Canada is English- and French-speaking). The ROC's people are
// Chinese named in the romanization used in Taiwan; the Mainland Region's
// in pinyin.
const P = (name, style, pool) => ({ name, style, pool });
export const PEOPLES = {
  chinese: P('Chinese', 'vale', 'zh'),
  roc: P('Chinese', 'vale', 'tw'),
  japanese: P('Japanese', 'vale', 'ja'),
  korean: P('Korean', 'vale', 'ko'),
  taiwanese: P('Taiwanese', 'vale', 'tw'),
  mongolian: P('Mongolian', 'frost', 'mn'),
  vietnamese: P('Vietnamese', 'mire', 'vi'),
  thai: P('Thai', 'mire', 'th'),
  lao: P('Lao', 'mire', 'th'),
  khmer: P('Khmer', 'mire', 'th'),
  burmese: P('Burmese', 'mire', 'th'),
  malay: P('Malay', 'mire', 'ms'),
  singaporean: P('Singaporean', 'mire', 'sg'),
  indonesian: P('Indonesian', 'mire', 'ms'),
  filipino: P('Filipino', 'mire', 'ph'),
  timorese: P('Timorese', 'mire', 'pt'),
  papuan: P('Papuan', 'mire', 'en'),
  indian: P('Indian', 'dune', 'hi'),
  pakistani: P('Pakistani', 'dune', 'ur'),
  bangladeshi: P('Bengali', 'mire', 'ur'),
  nepali: P('Nepali', 'frost', 'hi'),
  bhutanese: P('Bhutanese', 'frost', 'bo'),
  srilankan: P('Sri Lankan', 'mire', 'hi'),
  afghan: P('Afghan', 'dune', 'fa'),
  kazakh: P('Kazakh', 'dune', 'ca'),
  uzbek: P('Uzbek', 'dune', 'ca'),
  turkmen: P('Turkmen', 'dune', 'ca'),
  kyrgyz: P('Kyrgyz', 'frost', 'ca'),
  tajik: P('Tajik', 'dune', 'fa'),
  iranian: P('Persian', 'dune', 'fa'),
  iraqi: P('Iraqi', 'dune', 'ar'),
  saudi: P('Arabian', 'dune', 'ar'),
  turkish: P('Turkish', 'dune', 'tr'),
  syrian: P('Syrian', 'dune', 'ar'),
  jordanian: P('Jordanian', 'dune', 'ar'),
  israeli: P('Israeli', 'dune', 'he'),
  lebanese: P('Lebanese', 'dune', 'ar'),
  gulf: P('Gulf Arab', 'dune', 'ar'),
  omani: P('Omani', 'dune', 'ar'),
  yemeni: P('Yemeni', 'dune', 'ar'),
  azerbaijani: P('Azerbaijani', 'dune', 'tr'),
  georgian: P('Georgian', 'vale', 'ka'),
  armenian: P('Armenian', 'vale', 'hy'),
  cypriot: P('Cypriot', 'dune', 'el'),
  russian: P('Russian', 'frost', 'ru'),
  german: P('German', 'vale', 'de'),
  british: P('British', 'vale', 'en'),
  french: P('French', 'vale', 'fr'),
  italian: P('Italian', 'vale', 'it'),
  spanish: P('Spanish', 'vale', 'es'),
  portuguese: P('Portuguese', 'vale', 'pt'),
  dutch: P('Dutch', 'vale', 'nl'),
  belgian: P('Belgian', 'vale', 'nl'),
  swiss: P('Swiss', 'vale', 'de'),
  austrian: P('Austrian', 'vale', 'de'),
  czech: P('Czech', 'vale', 'cs'),
  slovak: P('Slovak', 'vale', 'cs'),
  hungarian: P('Hungarian', 'vale', 'hu'),
  polish: P('Polish', 'vale', 'pl'),
  danish: P('Danish', 'vale', 'nordic'),
  norwegian: P('Norwegian', 'frost', 'nordic'),
  swedish: P('Swedish', 'frost', 'nordic'),
  finnish: P('Finnish', 'frost', 'fi'),
  icelandic: P('Icelandic', 'frost', 'nordic'),
  irish: P('Irish', 'vale', 'en'),
  belarusian: P('Belarusian', 'frost', 'ru'),
  ukrainian: P('Ukrainian', 'vale', 'uk'),
  moldovan: P('Moldovan', 'vale', 'ro'),
  romanian: P('Romanian', 'vale', 'ro'),
  bulgarian: P('Bulgarian', 'vale', 'sl'),
  serbian: P('Serbian', 'vale', 'sl'),
  croatian: P('Croatian', 'vale', 'sl'),
  slovene: P('Slovene', 'vale', 'sl'),
  bosnian: P('Bosnian', 'vale', 'sl'),
  montenegrin: P('Montenegrin', 'vale', 'sl'),
  albanian: P('Albanian', 'vale', 'sq'),
  macedonian: P('Macedonian', 'vale', 'sl'),
  greek: P('Greek', 'vale', 'el'),
  estonian: P('Estonian', 'frost', 'fi'),
  latvian: P('Latvian', 'frost', 'balt'),
  lithuanian: P('Lithuanian', 'frost', 'balt'),
  egyptian: P('Egyptian', 'dune', 'ar'),
  libyan: P('Libyan', 'dune', 'ar'),
  tunisian: P('Tunisian', 'dune', 'ar'),
  algerian: P('Algerian', 'dune', 'ar'),
  moroccan: P('Moroccan', 'dune', 'ar'),
  mauritanian: P('Mauritanian', 'dune', 'ar'),
  sahelian: P('Sahelian', 'dune', 'waf'),
  sudanese: P('Sudanese', 'dune', 'ar'),
  ethiopian: P('Ethiopian', 'vale', 'et'),
  somali: P('Somali', 'dune', 'ar'),
  eastafrican: P('East African', 'mire', 'sw'),
  westafrican: P('West African', 'mire', 'waf'),
  centralafrican: P('Central African', 'mire', 'saf'),
  southernafrican: P('Southern African', 'mire', 'saf'),
  southafrican: P('South African', 'vale', 'saf'),
  malagasy: P('Malagasy', 'mire', 'mg'),
  australian: P('Australian', 'vale', 'en'),
  newzealander: P('New Zealander', 'vale', 'en'),
  american: P('American', 'vale', 'us'),
  canadian: P('Canadian', 'vale', ['en', 'en', 'qc']),
  mexican: P('Mexican', 'dune', 'es'),
  centralamerican: P('Central American', 'mire', 'es'),
  caribbean: P('Caribbean', 'mire', 'es'),
  haitian: P('Haitian', 'mire', 'fr'),
  westindian: P('West Indian', 'mire', 'en'),
  greenlandic: P('Greenlandic', 'frost', 'kl'),
  brazilian: P('Brazilian', 'vale', 'pt'),
  argentine: P('Argentine', 'vale', 'es'),
  andean: P('Andean', 'dune', 'es'),
  southamerican: P('South American', 'vale', 'es'),
  guyanese: P('Guyanese', 'mire', 'en'),
};

const pick = (rng, a) => a[Math.floor(rng.next() * a.length)];

// The people of a culture id ('vale~japanese' -> the Japanese), or null.
export function peopleOf(cultureId) {
  const key = String(cultureId || '').split('~')[1];
  return key && PEOPLES[key] ? PEOPLES[key] : null;
}

// The people key of a culture id ('vale~japanese~3' -> 'japanese'), or null.
export function peopleKey(cultureId) {
  const key = String(cultureId || '').split('~')[1];
  return key && PEOPLES[key] ? key : null;
}

// The culture id for a people key (in another of the four styles when the
// place data asks for one), or null.
export function peopleCultureId(key, style = null) {
  const p = PEOPLES[key];
  return p ? `${style || p.style}~${key}` : null;
}

// A personal name from a people's pool, or null when the culture is not one
// of them (the game's own cultures name their people themselves).
export function realPersonName(cultureId, sex, rng) {
  const p = peopleOf(cultureId);
  if (!p) return null;
  const pool = POOLS[Array.isArray(p.pool) ? pick(rng, p.pool) : p.pool];
  if (!pool) return null;
  const f = sex === 'f';
  const given = pick(rng, f ? pool.f : pool.m);
  const fams = pool.s || (f ? pool.sf : pool.sm);
  if (pool.order === 'f' || !fams) return given;
  const fam = pick(rng, fams);
  return pool.order === 'sf' ? `${fam} ${given}` : `${given} ${fam}`;
}
