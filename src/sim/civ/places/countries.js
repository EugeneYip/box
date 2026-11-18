// Real countries for the World Map and the regional maps: each with its
// capital and its major cities (largest or most important first), in common
// English names. Coordinates are degrees (longitude east, latitude north),
// accurate to about 0.1 degree. The region modules (world.js, europe.js, ...)
// choose which of these appear and in what order.
//
// China is split along roughly the Qinling-Huai line: "Mainland Region" holds
// the north (capital Beijing), "ROC" holds the south and Taiwan (capital
// Nanjing).

const P = (name, lon, lat) => ({ name, lon, lat });
const R = (name, capital, cities) => ({ name, capital: P(...capital), cities: cities.map((c) => P(...c)) });

export const COUNTRIES = {
  // ------------------------------------------------------------ East Asia
  mainland: R('Mainland Region', ['Beijing', 116.4, 39.9], [
    ['Tianjin', 117.2, 39.13], ["Xi'an", 108.94, 34.34], ['Shenyang', 123.43, 41.8], ['Harbin', 126.63, 45.75],
    ['Zhengzhou', 113.62, 34.75], ['Qingdao', 120.38, 36.07], ['Jinan', 117.0, 36.65], ['Dalian', 121.61, 38.91],
    ['Changchun', 125.32, 43.82], ['Shijiazhuang', 114.51, 38.04], ['Taiyuan', 112.55, 37.87], ['Lanzhou', 103.83, 36.06],
    ['Urumqi', 87.62, 43.83], ['Hohhot', 111.75, 40.84], ['Yinchuan', 106.23, 38.49], ['Xining', 101.78, 36.62],
    ['Kashgar', 75.99, 39.47], ['Baotou', 109.84, 40.66], ['Luoyang', 112.45, 34.62], ['Xuzhou', 117.18, 34.26],
    ['Qiqihar', 123.92, 47.35], ['Hailar', 119.77, 49.21], ['Hami', 93.51, 42.82], ['Jiuquan', 98.49, 39.73],
    ['Golmud', 94.9, 36.4], ['Yan\'an', 109.49, 36.59], ['Datong', 113.3, 40.09], ['Mudanjiang', 129.63, 44.55],
    ['Chongqing', 106.55, 29.56], ['Nanning', 108.37, 22.82], ['Lhasa', 91.11, 29.65],
    ['Shigatse', 88.88, 29.27], ['Wanzhou', 108.41, 30.81], ['Fuling', 107.39, 29.7], ['Beihai', 109.12, 21.48],
    ['Baise', 106.62, 23.9], ['Nyingchi', 94.36, 29.65],
  ]),
  roc: R('ROC', ['Nanjing', 118.8, 32.06], [
    ['Taipei', 121.56, 25.04], ['Shanghai', 121.47, 31.23], ['Guangzhou', 113.26, 23.13],
    ['Wuhan', 114.31, 30.59], ['Chengdu', 104.07, 30.67], ['Hong Kong', 114.17, 22.32], ['Hangzhou', 120.16, 30.27],
    ['Kunming', 102.83, 24.88], ['Changsha', 112.94, 28.23], ['Xiamen', 118.09, 24.48], ['Fuzhou', 119.3, 26.08],
    ['Kaohsiung', 120.3, 22.63], ['Guiyang', 106.63, 26.65],
    ['Nanchang', 115.86, 28.68], ['Hefei', 117.23, 31.82], ['Shenzhen', 114.06, 22.54], ['Haikou', 110.35, 20.02],
    ['Taichung', 120.68, 24.15], ['Ningbo', 121.55, 29.87], ['Suzhou', 120.62, 31.3], ['Wenzhou', 120.7, 28.0],
    ['Guilin', 110.29, 25.27], ['Shantou', 116.68, 23.35], ['Yichang', 111.29, 30.69],
    ['Sanya', 109.51, 18.25], ['Lijiang', 100.23, 26.87], ['Zhanjiang', 110.36, 21.27], ['Xiangyang', 112.14, 32.04],
  ]),
  japan: R('Japan', ['Tokyo', 139.69, 35.69], [
    ['Osaka', 135.5, 34.69], ['Sapporo', 141.35, 43.06], ['Fukuoka', 130.4, 33.59], ['Sendai', 140.87, 38.27],
    ['Nagoya', 136.91, 35.18], ['Hiroshima', 132.46, 34.39], ['Kyoto', 135.77, 35.01], ['Yokohama', 139.64, 35.44],
    ['Kobe', 135.2, 34.69], ['Kagoshima', 130.56, 31.6], ['Niigata', 139.02, 37.92], ['Kanazawa', 136.65, 36.56],
    ['Hakodate', 140.73, 41.77], ['Matsuyama', 132.77, 33.84], ['Kumamoto', 130.74, 32.8], ['Aomori', 140.74, 40.82],
    ['Akita', 140.1, 39.72], ['Asahikawa', 142.36, 43.77], ['Kushiro', 144.38, 42.98],
    ['Naha', 127.68, 26.21],
  ]),
  'south-korea': R('South Korea', ['Seoul', 126.98, 37.57], [
    ['Busan', 129.08, 35.18], ['Incheon', 126.71, 37.46], ['Daegu', 128.6, 35.87], ['Daejeon', 127.38, 36.35],
    ['Gwangju', 126.85, 35.16], ['Ulsan', 129.31, 35.54], ['Gangneung', 128.88, 37.75], ['Jeju', 126.53, 33.5],
    ['Pohang', 129.34, 36.02], ['Mokpo', 126.39, 34.81], ['Jeonju', 127.15, 35.82], ['Chuncheon', 127.73, 37.88],
    ['Cheongju', 127.49, 36.64], ['Andong', 128.73, 36.57], ['Yeosu', 127.66, 34.76],
  ]),
  'north-korea': R('North Korea', ['Pyongyang', 125.75, 39.03], [
    ['Hamhung', 127.54, 39.92], ['Chongjin', 129.78, 41.8], ['Nampo', 125.41, 38.74], ['Wonsan', 127.44, 39.15],
    ['Sinuiju', 124.4, 40.1], ['Kaesong', 126.55, 37.97], ['Hyesan', 128.18, 41.4], ['Kimchaek', 129.19, 40.67],
    ['Rason', 130.3, 42.26], ['Kanggye', 126.6, 40.97],
  ]),
  mongolia: R('Mongolia', ['Ulaanbaatar', 106.92, 47.92], [
    ['Erdenet', 104.08, 49.03], ['Darkhan', 105.97, 49.49], ['Choibalsan', 114.53, 48.07], ['Khovd', 91.64, 48.01],
    ['Ölgii', 89.97, 48.97], ['Mörön', 100.16, 49.64], ['Dalanzadgad', 104.42, 43.57], ['Sainshand', 110.14, 44.89],
    ['Arvaikheer', 102.78, 46.27], ['Uliastai', 96.84, 47.74], ['Bayankhongor', 100.72, 46.19], ['Altai', 96.25, 46.37],
    ['Baruun-Urt', 113.28, 46.68], ['Ulaangom', 92.07, 49.98],
  ]),

  // ------------------------------------------------------------ Southeast Asia
  vietnam: R('Vietnam', ['Hanoi', 105.85, 21.03], [
    ['Ho Chi Minh City', 106.7, 10.78], ['Da Nang', 108.22, 16.05], ['Haiphong', 106.68, 20.86], ['Hue', 107.58, 16.46],
    ['Can Tho', 105.78, 10.03], ['Nha Trang', 109.19, 12.24], ['Vinh', 105.68, 18.68], ['Da Lat', 108.44, 11.94],
    ['Quy Nhon', 109.22, 13.78], ['Buon Ma Thuot', 108.04, 12.67], ['Lao Cai', 103.97, 22.49], ['Dien Bien Phu', 103.02, 21.39],
    ['Ha Long', 107.08, 20.95], ['Ca Mau', 105.15, 9.18], ['Pleiku', 108.0, 13.98], ['Rach Gia', 105.08, 10.01],
  ]),
  laos: R('Laos', ['Vientiane', 102.63, 17.98], [
    ['Luang Prabang', 102.14, 19.89], ['Pakse', 105.78, 15.12], ['Savannakhet', 104.75, 16.55], ['Thakhek', 104.83, 17.4],
    ['Phonsavan', 103.22, 19.45], ['Luang Namtha', 101.4, 20.95], ['Xam Neua', 104.04, 20.42], ['Attapeu', 106.83, 14.81],
  ]),
  cambodia: R('Cambodia', ['Phnom Penh', 104.92, 11.56], [
    ['Siem Reap', 103.86, 13.36], ['Battambang', 103.2, 13.1], ['Sihanoukville', 103.53, 10.63], ['Kampot', 104.18, 10.61],
    ['Kampong Cham', 105.46, 12.0], ['Kratie', 106.02, 12.49], ['Stung Treng', 105.97, 13.53], ['Koh Kong', 102.98, 11.62],
    ['Banlung', 106.98, 13.74],
  ]),
  thailand: R('Thailand', ['Bangkok', 100.5, 13.76], [
    ['Chiang Mai', 98.99, 18.79], ['Phuket', 98.39, 7.88], ['Khon Kaen', 102.83, 16.43], ['Nakhon Ratchasima', 102.1, 14.97],
    ['Hat Yai', 100.47, 7.01], ['Udon Thani', 102.79, 17.41], ['Ubon Ratchathani', 104.86, 15.24], ['Pattaya', 100.88, 12.93],
    ['Chiang Rai', 99.83, 19.91], ['Surat Thani', 99.32, 9.14], ['Phitsanulok', 100.26, 16.82], ['Nakhon Sawan', 100.12, 15.7],
    ['Hua Hin', 99.96, 12.57], ['Mae Sot', 98.57, 16.71], ['Nakhon Si Thammarat', 99.96, 8.43], ['Trat', 102.51, 12.24],
  ]),
  myanmar: R('Myanmar', ['Naypyidaw', 96.13, 19.75], [
    ['Yangon', 96.16, 16.84], ['Mandalay', 96.08, 21.97], ['Mawlamyine', 97.63, 16.49], ['Sittwe', 92.9, 20.15],
    ['Myitkyina', 97.4, 25.38], ['Taunggyi', 97.04, 20.79], ['Pathein', 94.73, 16.78], ['Lashio', 97.75, 22.94],
    ['Bago', 96.48, 17.34], ['Monywa', 95.13, 22.11], ['Magway', 94.93, 20.15], ['Dawei', 98.2, 14.08],
    ['Myeik', 98.6, 12.44], ['Kawthaung', 98.55, 9.98], ['Bagan', 94.86, 21.17], ['Putao', 97.4, 27.33],
  ]),
  malaysia: R('Malaysia', ['Kuala Lumpur', 101.69, 3.14], [
    ['George Town', 100.33, 5.41], ['Kuching', 110.35, 1.55], ['Kota Kinabalu', 116.07, 5.98], ['Johor Bahru', 103.76, 1.49],
    ['Ipoh', 101.08, 4.6], ['Kuantan', 103.33, 3.82], ['Kota Bharu', 102.24, 6.13], ['Malacca', 102.25, 2.19],
    ['Sandakan', 118.07, 5.84], ['Miri', 113.99, 4.4], ['Sibu', 111.82, 2.29], ['Alor Setar', 100.37, 6.12],
    ['Kuala Terengganu', 103.14, 5.33], ['Tawau', 117.89, 4.24], ['Bintulu', 113.03, 3.17],
  ]),
  singapore: R('Singapore', ['Singapore', 103.82, 1.35], [
    ['Woodlands', 103.79, 1.44], ['Jurong', 103.71, 1.33], ['Tampines', 103.94, 1.35],
  ]),
  brunei: R('Brunei', ['Bandar Seri Begawan', 114.94, 4.89], [
    ['Seria', 114.33, 4.61], ['Kuala Belait', 114.2, 4.58], ['Tutong', 114.65, 4.8], ['Bangar', 115.07, 4.71],
  ]),
  indonesia: R('Indonesia', ['Jakarta', 106.85, -6.21], [
    ['Surabaya', 112.75, -7.25], ['Medan', 98.67, 3.6], ['Makassar', 119.43, -5.15], ['Bandung', 107.61, -6.92],
    ['Palembang', 104.75, -2.98], ['Balikpapan', 116.83, -1.27], ['Denpasar', 115.22, -8.65], ['Semarang', 110.42, -6.97],
    ['Pontianak', 109.34, -0.03], ['Manado', 124.84, 1.47], ['Jayapura', 140.72, -2.53], ['Padang', 100.35, -0.95],
    ['Banda Aceh', 95.32, 5.55], ['Yogyakarta', 110.37, -7.8], ['Ambon', 128.18, -3.7], ['Kupang', 123.6, -10.17],
    ['Banjarmasin', 114.59, -3.32], ['Samarinda', 117.15, -0.5], ['Pekanbaru', 101.45, 0.51], ['Mataram', 116.12, -8.58],
    ['Sorong', 131.25, -0.88], ['Palu', 119.87, -0.9], ['Kendari', 122.51, -3.97], ['Ternate', 127.38, 0.79],
    ['Merauke', 140.4, -8.49], ['Bengkulu', 102.27, -3.8], ['Jambi', 103.61, -1.61], ['Bandar Lampung', 105.26, -5.43],
  ]),
  'timor-leste': R('Timor-Leste', ['Dili', 125.57, -8.56], [
    ['Baucau', 126.45, -8.47], ['Maliana', 125.22, -8.99], ['Suai', 125.25, -9.31], ['Lospalos', 127.0, -8.52],
    ['Same', 125.65, -9.0], ['Pante Macassar', 124.37, -9.2],
  ]),
  philippines: R('Philippines', ['Manila', 120.98, 14.6], [
    ['Cebu City', 123.89, 10.32], ['Davao City', 125.61, 7.07], ['Zamboanga City', 122.08, 6.91], ['Cagayan de Oro', 124.65, 8.48],
    ['Iloilo City', 122.56, 10.72], ['Baguio', 120.6, 16.4], ['Bacolod', 122.95, 10.68], ['General Santos', 125.17, 6.11],
    ['Tacloban', 125.0, 11.24], ['Puerto Princesa', 118.74, 9.74], ['Legazpi', 123.74, 13.14], ['Laoag', 120.59, 18.2],
    ['Tuguegarao', 121.73, 17.61], ['Naga', 123.18, 13.62], ['Butuan', 125.54, 8.95], ['Dumaguete', 123.31, 9.31],
    ['Cotabato City', 124.25, 7.22], ['Batangas', 121.06, 13.76],
  ]),
  'papua-new-guinea': R('Papua New Guinea', ['Port Moresby', 147.18, -9.44], [
    ['Lae', 147.0, -6.73], ['Mount Hagen', 144.23, -5.86], ['Madang', 145.79, -5.22], ['Wewak', 143.63, -3.55],
    ['Goroka', 145.39, -6.08], ['Rabaul', 152.18, -4.2], ['Alotau', 150.46, -10.31], ['Kimbe', 150.14, -5.55],
    ['Daru', 143.21, -9.07], ['Vanimo', 141.3, -2.68], ['Kavieng', 150.8, -2.57], ['Popondetta', 148.24, -8.77],
  ]),

  // ------------------------------------------------------------ South Asia
  india: R('India', ['New Delhi', 77.21, 28.61], [
    ['Mumbai', 72.88, 19.08], ['Kolkata', 88.36, 22.57], ['Bengaluru', 77.59, 12.97], ['Chennai', 80.27, 13.08],
    ['Hyderabad', 78.49, 17.39], ['Ahmedabad', 72.57, 23.02], ['Pune', 73.86, 18.52], ['Jaipur', 75.79, 26.91],
    ['Lucknow', 80.95, 26.85], ['Nagpur', 79.09, 21.15], ['Patna', 85.14, 25.59], ['Bhopal', 77.41, 23.26],
    ['Kochi', 76.27, 9.93], ['Guwahati', 91.74, 26.14], ['Visakhapatnam', 83.22, 17.69], ['Srinagar', 74.8, 34.08],
    ['Varanasi', 82.97, 25.32], ['Amritsar', 74.87, 31.63], ['Bhubaneswar', 85.82, 20.3], ['Surat', 72.83, 21.17],
    ['Indore', 75.86, 22.72], ['Raipur', 81.63, 21.25], ['Ranchi', 85.31, 23.34], ['Thiruvananthapuram', 76.94, 8.52],
    ['Jodhpur', 73.02, 26.24], ['Leh', 77.58, 34.16], ['Madurai', 78.12, 9.93], ['Goa', 73.83, 15.49],
    ['Imphal', 93.94, 24.82], ['Shillong', 91.89, 25.58], ['Agartala', 91.28, 23.83], ['Dibrugarh', 94.91, 27.47],
    ['Siliguri', 88.43, 26.73], ['Kohima', 94.11, 25.67], ['Itanagar', 93.62, 27.08], ['Port Blair', 92.73, 11.62],
  ]),
  pakistan: R('Pakistan', ['Islamabad', 73.05, 33.68], [
    ['Karachi', 67.01, 24.86], ['Lahore', 74.36, 31.55], ['Faisalabad', 73.08, 31.42], ['Peshawar', 71.58, 34.01],
    ['Quetta', 67.0, 30.18], ['Multan', 71.47, 30.2], ['Sukkur', 68.86, 27.71], ['Gwadar', 62.33, 25.12],
    ['Gilgit', 74.31, 35.92], ['Bahawalpur', 71.68, 29.4], ['Dera Ismail Khan', 70.9, 31.83], ['Turbat', 63.05, 26.0],
    ['Sialkot', 74.53, 32.49], ['Chitral', 71.79, 35.85],
  ]),
  bangladesh: R('Bangladesh', ['Dhaka', 90.41, 23.81], [
    ['Chittagong', 91.83, 22.36], ['Khulna', 89.56, 22.85], ['Rajshahi', 88.6, 24.37], ['Sylhet', 91.87, 24.89],
    ['Rangpur', 89.25, 25.74], ['Barisal', 90.37, 22.7], ['Mymensingh', 90.41, 24.75], ["Cox's Bazar", 91.98, 21.43],
    ['Comilla', 91.18, 23.46],
  ]),
  nepal: R('Nepal', ['Kathmandu', 85.32, 27.72], [
    ['Pokhara', 83.99, 28.21], ['Biratnagar', 87.27, 26.45], ['Birgunj', 84.88, 27.01], ['Nepalgunj', 81.62, 28.05],
    ['Dhangadhi', 80.59, 28.7], ['Bharatpur', 84.43, 27.68], ['Janakpur', 85.92, 26.73], ['Butwal', 83.45, 27.7],
  ]),
  bhutan: R('Bhutan', ['Thimphu', 89.64, 27.47], [
    ['Phuntsholing', 89.39, 26.85], ['Punakha', 89.86, 27.59], ['Gelephu', 90.48, 26.87], ['Trongsa', 90.5, 27.5],
    ['Trashigang', 91.55, 27.33], ['Samdrup Jongkhar', 91.5, 26.8],
  ]),
  'sri-lanka': R('Sri Lanka', ['Colombo', 79.86, 6.93], [
    ['Kandy', 80.64, 7.29], ['Jaffna', 80.01, 9.66], ['Galle', 80.22, 6.03], ['Trincomalee', 81.23, 8.59],
    ['Batticaloa', 81.69, 7.72], ['Anuradhapura', 80.4, 8.31], ['Matara', 80.55, 5.95],
  ]),
  afghanistan: R('Afghanistan', ['Kabul', 69.17, 34.53], [
    ['Kandahar', 65.71, 31.61], ['Herat', 62.2, 34.35], ['Mazar-i-Sharif', 67.11, 36.71], ['Jalalabad', 70.45, 34.43],
    ['Kunduz', 68.86, 36.73], ['Ghazni', 68.42, 33.55], ['Bamyan', 67.83, 34.82], ['Lashkar Gah', 64.37, 31.59],
    ['Faizabad', 70.58, 37.12], ['Farah', 62.11, 32.37],
  ]),

  // ------------------------------------------------------------ Central Asia
  kazakhstan: R('Kazakhstan', ['Astana', 71.43, 51.13], [
    ['Almaty', 76.89, 43.24], ['Shymkent', 69.6, 42.32], ['Karaganda', 73.1, 49.81], ['Aktobe', 57.21, 50.28],
    ['Atyrau', 51.92, 47.11], ['Oskemen', 82.61, 49.95], ['Pavlodar', 76.97, 52.29], ['Aktau', 51.2, 43.65],
    ['Kostanay', 63.63, 53.21], ['Kyzylorda', 65.51, 44.85], ['Semey', 80.23, 50.41], ['Taraz', 71.37, 42.9],
    ['Oral', 51.37, 51.23], ['Petropavl', 69.15, 54.87], ['Zhezkazgan', 67.71, 47.8], ['Balkhash', 74.99, 46.85],
    ['Taldykorgan', 78.37, 45.02], ['Baikonur', 63.31, 45.62],
  ]),
  uzbekistan: R('Uzbekistan', ['Tashkent', 69.24, 41.3], [
    ['Samarkand', 66.96, 39.65], ['Bukhara', 64.42, 39.77], ['Nukus', 59.61, 42.46], ['Namangan', 71.67, 41.0],
    ['Andijan', 72.34, 40.78], ['Khiva', 60.36, 41.38], ['Qarshi', 65.79, 38.86], ['Termez', 67.28, 37.22],
    ['Navoiy', 65.38, 40.1], ['Fergana', 71.78, 40.38],
  ]),
  turkmenistan: R('Turkmenistan', ['Ashgabat', 58.38, 37.95], [
    ['Turkmenabat', 63.58, 39.07], ['Dashoguz', 59.96, 41.84], ['Mary', 61.83, 37.59], ['Balkanabat', 54.37, 39.51],
    ['Turkmenbashi', 52.97, 40.02], ['Tejen', 60.5, 37.38],
  ]),
  kyrgyzstan: R('Kyrgyzstan', ['Bishkek', 74.59, 42.87], [
    ['Osh', 72.8, 40.53], ['Jalal-Abad', 73.0, 40.93], ['Karakol', 78.39, 42.49], ['Naryn', 75.99, 41.43],
    ['Talas', 72.24, 42.52], ['Batken', 70.82, 40.06], ['Cholpon-Ata', 77.08, 42.65],
  ]),
  tajikistan: R('Tajikistan', ['Dushanbe', 68.79, 38.56], [
    ['Khujand', 69.62, 40.28], ['Kulob', 69.78, 37.91], ['Bokhtar', 68.78, 37.84], ['Khorog', 71.55, 37.49],
    ['Murghob', 73.97, 38.17], ['Panjakent', 67.61, 39.5],
  ]),

  // ------------------------------------------------------------ Middle East
  iran: R('Iran', ['Tehran', 51.39, 35.69], [
    ['Mashhad', 59.61, 36.3], ['Isfahan', 51.67, 32.65], ['Tabriz', 46.29, 38.08], ['Shiraz', 52.53, 29.59],
    ['Ahvaz', 48.67, 31.32], ['Kerman', 57.08, 30.28], ['Bandar Abbas', 56.27, 27.18], ['Rasht', 49.58, 37.28],
    ['Zahedan', 60.86, 29.5], ['Yazd', 54.37, 31.9], ['Kermanshah', 47.07, 34.31], ['Hamadan', 48.51, 34.8],
    ['Bushehr', 50.84, 28.97], ['Urmia', 45.07, 37.55], ['Chabahar', 60.64, 25.29], ['Birjand', 59.22, 32.87],
    ['Sari', 53.06, 36.56], ['Qom', 50.88, 34.64],
  ]),
  iraq: R('Iraq', ['Baghdad', 44.36, 33.31], [
    ['Basra', 47.78, 30.51], ['Mosul', 43.13, 36.34], ['Erbil', 44.01, 36.19], ['Kirkuk', 44.39, 35.47],
    ['Najaf', 44.34, 32.0], ['Sulaymaniyah', 45.43, 35.56], ['Ramadi', 43.3, 33.43], ['Nasiriyah', 46.26, 31.05],
    ['Karbala', 44.02, 32.62],
  ]),
  'saudi-arabia': R('Saudi Arabia', ['Riyadh', 46.72, 24.71], [
    ['Jeddah', 39.17, 21.49], ['Mecca', 39.83, 21.42], ['Medina', 39.61, 24.47], ['Dammam', 50.1, 26.43],
    ['Tabuk', 36.57, 28.38], ['Abha', 42.51, 18.22], ["Ha'il", 41.69, 27.52], ['Buraydah', 43.97, 26.33],
    ['Jizan', 42.55, 16.89], ['Najran', 44.13, 17.49], ['Hofuf', 49.59, 25.36], ['Sakaka', 40.21, 29.97],
    ['Yanbu', 38.06, 24.09],
  ]),
  turkey: R('Turkey', ['Ankara', 32.85, 39.93], [
    ['Istanbul', 28.98, 41.01], ['Izmir', 27.14, 38.42], ['Antalya', 30.71, 36.9], ['Bursa', 29.06, 40.19],
    ['Adana', 35.32, 37.0], ['Trabzon', 39.72, 41.0], ['Konya', 32.48, 37.87], ['Gaziantep', 37.38, 37.07],
    ['Diyarbakır', 40.23, 37.91], ['Erzurum', 41.27, 39.9], ['Samsun', 36.33, 41.29], ['Kayseri', 35.48, 38.73],
    ['Van', 43.38, 38.5], ['Eskişehir', 30.52, 39.78], ['Sivas', 37.02, 39.75], ['Malatya', 38.31, 38.35],
    ['Edirne', 26.56, 41.68],
  ]),
  syria: R('Syria', ['Damascus', 36.29, 33.51], [
    ['Aleppo', 37.16, 36.2], ['Homs', 36.72, 34.73], ['Latakia', 35.78, 35.52], ['Deir ez-Zor', 40.14, 35.33],
    ['Raqqa', 39.01, 35.95], ['Hama', 36.75, 35.13], ['Qamishli', 41.23, 37.05], ['Palmyra', 38.28, 34.56],
  ]),
  jordan: R('Jordan', ['Amman', 35.93, 31.95], [
    ['Aqaba', 35.01, 29.53], ['Irbid', 35.85, 32.56], ['Zarqa', 36.09, 32.07], ["Ma'an", 35.73, 30.19], ['Karak', 35.7, 31.18],
  ]),
  israel: R('Israel', ['Jerusalem', 35.22, 31.77], [
    ['Tel Aviv', 34.78, 32.09], ['Haifa', 34.99, 32.79], ['Beersheba', 34.79, 31.25], ['Eilat', 34.95, 29.56],
    ['Nazareth', 35.3, 32.7],
  ]),
  lebanon: R('Lebanon', ['Beirut', 35.5, 33.89], [
    ['Sidon', 35.37, 33.56], ['Tyre', 35.2, 33.27], ['Baalbek', 36.21, 34.01], ['Byblos', 35.65, 34.12],
  ]),
  kuwait: R('Kuwait', ['Kuwait City', 47.98, 29.38], [['Al Jahra', 47.66, 29.34], ['Al Ahmadi', 48.08, 29.08]]),
  qatar: R('Qatar', ['Doha', 51.53, 25.29], [['Al Khor', 51.5, 25.68], ['Dukhan', 50.79, 25.42], ['Al Wakrah', 51.6, 25.17]]),
  uae: R('United Arab Emirates', ['Abu Dhabi', 54.37, 24.45], [
    ['Dubai', 55.27, 25.2], ['Sharjah', 55.39, 25.35], ['Al Ain', 55.76, 24.21], ['Ras Al Khaimah', 55.94, 25.79],
    ['Fujairah', 56.33, 25.13], ['Ruwais', 52.73, 24.11],
  ]),
  oman: R('Oman', ['Muscat', 58.41, 23.59], [
    ['Salalah', 54.09, 17.02], ['Sohar', 56.71, 24.35], ['Nizwa', 57.53, 22.93], ['Sur', 59.53, 22.57],
    ['Duqm', 57.7, 19.66], ['Ibri', 56.52, 23.23], ['Khasab', 56.24, 26.18],
  ]),
  yemen: R('Yemen', ['Sanaa', 44.21, 15.37], [
    ['Aden', 45.03, 12.79], ['Taiz', 44.02, 13.58], ['Hodeidah', 42.95, 14.8], ['Mukalla', 49.12, 14.54],
    ['Ibb', 44.18, 13.97], ['Sayun', 48.79, 15.94], ['Marib', 45.32, 15.46],
  ]),
  azerbaijan: R('Azerbaijan', ['Baku', 49.87, 40.41], [
    ['Ganja', 46.36, 40.68], ['Sumgait', 49.67, 40.59], ['Lankaran', 48.85, 38.75], ['Shaki', 47.17, 41.19],
    ['Nakhchivan', 45.41, 39.21], ['Mingachevir', 47.05, 40.76],
  ]),
  georgia: R('Georgia', ['Tbilisi', 44.79, 41.72], [
    ['Batumi', 41.64, 41.65], ['Kutaisi', 42.7, 42.27], ['Rustavi', 45.0, 41.55], ['Zugdidi', 41.87, 42.51],
    ['Telavi', 45.47, 41.92], ['Poti', 41.67, 42.15],
  ]),
  armenia: R('Armenia', ['Yerevan', 44.51, 40.18], [
    ['Gyumri', 43.85, 40.79], ['Vanadzor', 44.49, 40.81], ['Kapan', 46.41, 39.21], ['Sevan', 44.95, 40.55],
  ]),
  cyprus: R('Cyprus', ['Nicosia', 33.37, 35.17], [
    ['Limassol', 33.04, 34.68], ['Larnaca', 33.63, 34.92], ['Paphos', 32.42, 34.77], ['Famagusta', 33.94, 35.12],
    ['Kyrenia', 33.32, 35.34],
  ]),

  // ------------------------------------------------------------ Russia
  russia: R('Russia', ['Moscow', 37.62, 55.76], [
    ['Saint Petersburg', 30.32, 59.94], ['Novosibirsk', 82.92, 55.03], ['Yekaterinburg', 60.61, 56.84], ['Vladivostok', 131.89, 43.12],
    ['Kazan', 49.11, 55.8], ['Krasnoyarsk', 92.87, 56.01], ['Irkutsk', 104.28, 52.29], ['Omsk', 73.37, 54.99],
    ['Samara', 50.1, 53.2], ['Volgograd', 44.51, 48.71], ['Rostov-on-Don', 39.72, 47.22], ['Murmansk', 33.08, 68.97],
    ['Arkhangelsk', 40.54, 64.54], ['Yakutsk', 129.73, 62.03], ['Khabarovsk', 135.07, 48.48], ['Perm', 56.23, 58.01],
    ['Ufa', 55.96, 54.74], ['Chelyabinsk', 61.4, 55.16], ['Nizhny Novgorod', 44.0, 56.33], ['Tyumen', 65.53, 57.15],
    ['Magadan', 150.8, 59.56], ['Petropavlovsk-Kamchatsky', 158.65, 53.02], ['Norilsk', 88.2, 69.35], ['Chita', 113.5, 52.03],
    ['Ulan-Ude', 107.58, 51.83], ['Barnaul', 83.78, 53.35], ['Tomsk', 84.95, 56.49], ['Kaliningrad', 20.51, 54.71],
    ['Sochi', 39.72, 43.6], ['Krasnodar', 38.98, 45.04], ['Astrakhan', 48.03, 46.35], ['Voronezh', 39.2, 51.66],
    ['Saratov', 46.03, 51.53], ['Orenburg', 55.1, 51.77], ['Yuzhno-Sakhalinsk', 142.74, 46.96], ['Blagoveshchensk', 127.53, 50.26],
    ['Kemerovo', 86.09, 55.35], ['Komsomolsk-on-Amur', 137.01, 50.55], ['Nakhodka', 132.87, 42.82], ['Vorkuta', 64.0, 67.5],
    ['Syktyvkar', 50.84, 61.67], ['Surgut', 73.4, 61.25], ['Salekhard', 66.6, 66.53], ['Anadyr', 177.51, 64.73],
    ['Tiksi', 128.87, 71.64], ['Bratsk', 101.63, 56.15], ['Kyzyl', 94.45, 51.72], ['Petrozavodsk', 34.35, 61.79],
    ['Smolensk', 32.05, 54.78], ['Pskov', 28.33, 57.82], ['Makhachkala', 47.5, 42.98],
  ]),

  // ------------------------------------------------------------ Europe
  germany: R('Germany', ['Berlin', 13.4, 52.52], [
    ['Hamburg', 9.99, 53.55], ['Munich', 11.58, 48.14], ['Cologne', 6.96, 50.94], ['Frankfurt', 8.68, 50.11],
    ['Stuttgart', 9.18, 48.78], ['Düsseldorf', 6.77, 51.23], ['Leipzig', 12.37, 51.34], ['Dresden', 13.74, 51.05],
    ['Hanover', 9.73, 52.37], ['Nuremberg', 11.08, 49.45], ['Bremen', 8.8, 53.08], ['Kiel', 10.12, 54.32],
    ['Rostock', 12.1, 54.09], ['Dortmund', 7.47, 51.51], ['Freiburg', 7.84, 48.0], ['Erfurt', 11.03, 50.98],
    ['Magdeburg', 11.63, 52.12], ['Saarbrücken', 7.0, 49.24], ['Regensburg', 12.1, 49.01],
  ]),
  'united-kingdom': R('United Kingdom', ['London', -0.13, 51.51], [
    ['Birmingham', -1.9, 52.49], ['Manchester', -2.24, 53.48], ['Glasgow', -4.25, 55.86], ['Edinburgh', -3.19, 55.95],
    ['Liverpool', -2.98, 53.41], ['Leeds', -1.55, 53.8], ['Bristol', -2.59, 51.45], ['Newcastle', -1.61, 54.98],
    ['Cardiff', -3.18, 51.48], ['Belfast', -5.93, 54.6], ['Aberdeen', -2.09, 57.15], ['Inverness', -4.22, 57.48],
    ['Plymouth', -4.14, 50.38], ['Southampton', -1.4, 50.9], ['Norwich', 1.3, 52.63], ['York', -1.08, 53.96],
    ['Sheffield', -1.47, 53.38], ['Swansea', -3.94, 51.62], ['Dundee', -2.97, 56.46], ['Kirkwall', -2.96, 58.98],
    ['Lerwick', -1.14, 60.15], ['Cambridge', 0.12, 52.21], ['Oxford', -1.26, 51.75], ['Stornoway', -6.39, 58.21],
  ]),
  france: R('France', ['Paris', 2.35, 48.86], [
    ['Marseille', 5.37, 43.3], ['Lyon', 4.84, 45.76], ['Toulouse', 1.44, 43.6], ['Bordeaux', -0.58, 44.84],
    ['Nice', 7.26, 43.7], ['Nantes', -1.55, 47.22], ['Strasbourg', 7.75, 48.57], ['Lille', 3.06, 50.63],
    ['Brest', -4.49, 48.39], ['Rennes', -1.68, 48.11], ['Montpellier', 3.88, 43.61], ['Rouen', 1.1, 49.44],
    ['Grenoble', 5.72, 45.19], ['Dijon', 5.04, 47.32], ['Clermont-Ferrand', 3.09, 45.78], ['Limoges', 1.26, 45.83],
    ['Reims', 4.03, 49.26], ['Ajaccio', 8.74, 41.92], ['Le Havre', 0.11, 49.49], ['Orléans', 1.91, 47.9],
    ['Tours', 0.69, 47.39], ['Perpignan', 2.9, 42.7], ['Bayonne', -1.47, 43.49], ['Metz', 6.18, 49.12],
    ['Calais', 1.86, 50.95], ['Poitiers', 0.34, 46.58], ['La Rochelle', -1.15, 46.16], ['Bastia', 9.45, 42.7],
    ['Cherbourg', -1.62, 49.64],
  ]),
  italy: R('Italy', ['Rome', 12.5, 41.9], [
    ['Milan', 9.19, 45.46], ['Naples', 14.27, 40.85], ['Turin', 7.69, 45.07], ['Palermo', 13.36, 38.12],
    ['Genoa', 8.93, 44.41], ['Bologna', 11.34, 44.49], ['Florence', 11.26, 43.77], ['Venice', 12.32, 45.44],
    ['Bari', 16.87, 41.12], ['Catania', 15.09, 37.5], ['Cagliari', 9.11, 39.22], ['Verona', 10.99, 45.44],
    ['Trieste', 13.78, 45.65], ['Reggio Calabria', 15.65, 38.11], ['Pescara', 14.21, 42.46], ['Ancona', 13.52, 43.62],
    ['Messina', 15.55, 38.19], ['Sassari', 8.56, 40.73], ['Taranto', 17.24, 40.47], ['Perugia', 12.39, 43.11],
    ['Bolzano', 11.35, 46.5], ['Lecce', 18.17, 40.35], ['Salerno', 14.77, 40.68], ['Syracuse', 15.29, 37.08],
    ['Trento', 11.12, 46.07],
  ]),
  spain: R('Spain', ['Madrid', -3.7, 40.42], [
    ['Barcelona', 2.17, 41.39], ['Valencia', -0.38, 39.47], ['Seville', -5.98, 37.39], ['Bilbao', -2.93, 43.26],
    ['Málaga', -4.42, 36.72], ['Zaragoza', -0.88, 41.65], ['A Coruña', -8.41, 43.36], ['Palma', 2.65, 39.57],
    ['Murcia', -1.13, 37.99], ['Valladolid', -4.72, 41.65], ['Granada', -3.6, 37.18], ['Alicante', -0.48, 38.35],
    ['Salamanca', -5.66, 40.97], ['Oviedo', -5.84, 43.36], ['Santander', -3.81, 43.46], ['Pamplona', -1.64, 42.81],
    ['Badajoz', -6.97, 38.88], ['Cádiz', -6.29, 36.53], ['Almería', -2.46, 36.84], ['Santiago de Compostela', -8.54, 42.88],
    ['Vigo', -8.72, 42.24], ['Toledo', -4.03, 39.86], ['Las Palmas', -15.42, 28.12], ['Santa Cruz de Tenerife', -16.25, 28.47],
    ['Tarragona', 1.25, 41.12], ['Burgos', -3.7, 42.34],
  ]),
  portugal: R('Portugal', ['Lisbon', -9.14, 38.72], [
    ['Porto', -8.61, 41.15], ['Braga', -8.43, 41.55], ['Coimbra', -8.43, 40.21], ['Faro', -7.93, 37.02],
    ['Évora', -7.91, 38.57], ['Funchal', -16.91, 32.65], ['Ponta Delgada', -25.67, 37.74], ['Viseu', -7.91, 40.66],
    ['Bragança', -6.76, 41.81], ['Aveiro', -8.65, 40.64],
  ]),
  netherlands: R('Netherlands', ['Amsterdam', 4.9, 52.37], [
    ['Rotterdam', 4.48, 51.92], ['The Hague', 4.3, 52.08], ['Utrecht', 5.12, 52.09], ['Eindhoven', 5.47, 51.44],
    ['Groningen', 6.57, 53.22], ['Maastricht', 5.69, 50.85], ['Leeuwarden', 5.8, 53.2], ['Zwolle', 6.08, 52.52],
    ['Arnhem', 5.9, 51.98],
  ]),
  belgium: R('Belgium', ['Brussels', 4.35, 50.85], [
    ['Antwerp', 4.4, 51.22], ['Ghent', 3.72, 51.05], ['Liège', 5.57, 50.63], ['Bruges', 3.22, 51.21],
    ['Charleroi', 4.44, 50.41], ['Namur', 4.87, 50.47], ['Ostend', 2.92, 51.23],
  ]),
  switzerland: R('Switzerland', ['Bern', 7.45, 46.95], [
    ['Zurich', 8.54, 47.38], ['Geneva', 6.14, 46.2], ['Basel', 7.59, 47.56], ['Lausanne', 6.63, 46.52],
    ['Lucerne', 8.31, 47.05], ['Lugano', 8.95, 46.0], ['St. Gallen', 9.38, 47.42], ['Chur', 9.53, 46.85],
    ['Sion', 7.36, 46.23],
  ]),
  austria: R('Austria', ['Vienna', 16.37, 48.21], [
    ['Graz', 15.44, 47.07], ['Linz', 14.29, 48.31], ['Salzburg', 13.04, 47.81], ['Innsbruck', 11.4, 47.27],
    ['Klagenfurt', 14.31, 46.62], ['Bregenz', 9.75, 47.5], ['Villach', 13.85, 46.61],
  ]),
  czechia: R('Czechia', ['Prague', 14.42, 50.08], [
    ['Brno', 16.61, 49.2], ['Ostrava', 18.29, 49.82], ['Plzeň', 13.38, 49.75], ['Olomouc', 17.25, 49.59],
    ['Liberec', 15.06, 50.77], ['České Budějovice', 14.47, 48.97], ['Hradec Králové', 15.83, 50.21], ['Karlovy Vary', 12.87, 50.23],
  ]),
  slovakia: R('Slovakia', ['Bratislava', 17.11, 48.15], [
    ['Košice', 21.26, 48.72], ['Žilina', 18.74, 49.22], ['Banská Bystrica', 19.15, 48.74], ['Prešov', 21.24, 49.0],
    ['Nitra', 18.09, 48.31], ['Poprad', 20.3, 49.06],
  ]),
  hungary: R('Hungary', ['Budapest', 19.04, 47.5], [
    ['Debrecen', 21.63, 47.53], ['Szeged', 20.15, 46.25], ['Miskolc', 20.78, 48.1], ['Pécs', 18.23, 46.07],
    ['Győr', 17.64, 47.69], ['Kecskemét', 19.69, 46.91], ['Szombathely', 16.62, 47.23], ['Nyíregyháza', 21.72, 47.95],
  ]),
  poland: R('Poland', ['Warsaw', 21.01, 52.23], [
    ['Kraków', 19.94, 50.06], ['Gdańsk', 18.65, 54.35], ['Wrocław', 17.04, 51.11], ['Poznań', 16.93, 52.41],
    ['Łódź', 19.46, 51.76], ['Szczecin', 14.55, 53.43], ['Lublin', 22.57, 51.25], ['Białystok', 23.16, 53.13],
    ['Katowice', 19.02, 50.26], ['Rzeszów', 22.0, 50.04], ['Olsztyn', 20.49, 53.78], ['Bydgoszcz', 18.01, 53.12],
    ['Zakopane', 19.95, 49.3],
  ]),
  denmark: R('Denmark', ['Copenhagen', 12.57, 55.68], [
    ['Aarhus', 10.2, 56.16], ['Odense', 10.39, 55.4], ['Aalborg', 9.92, 57.05], ['Esbjerg', 8.45, 55.47],
    ['Tórshavn', -6.77, 62.01], ['Skagen', 10.59, 57.72], ['Rønne', 14.69, 55.1], ['Kolding', 9.47, 55.49],
  ]),
  norway: R('Norway', ['Oslo', 10.75, 59.91], [
    ['Bergen', 5.32, 60.39], ['Trondheim', 10.4, 63.43], ['Stavanger', 5.73, 58.97], ['Tromsø', 18.96, 69.65],
    ['Bodø', 14.4, 67.28], ['Kristiansand', 8.0, 58.15], ['Ålesund', 6.15, 62.47], ['Hammerfest', 23.68, 70.66],
    ['Kirkenes', 30.05, 69.73], ['Lillehammer', 10.47, 61.12], ['Narvik', 17.43, 68.44], ['Alta', 23.27, 69.97],
    ['Longyearbyen', 15.65, 78.22],
  ]),
  sweden: R('Sweden', ['Stockholm', 18.07, 59.33], [
    ['Gothenburg', 11.97, 57.71], ['Malmö', 13.0, 55.6], ['Uppsala', 17.64, 59.86], ['Umeå', 20.26, 63.83],
    ['Luleå', 22.15, 65.58], ['Kiruna', 20.23, 67.86], ['Östersund', 14.64, 63.18], ['Sundsvall', 17.31, 62.39],
    ['Visby', 18.29, 57.64], ['Karlstad', 13.5, 59.38], ['Kalmar', 16.36, 56.66], ['Linköping', 15.62, 58.41],
    ['Örebro', 15.21, 59.27], ['Gävle', 17.14, 60.67], ['Jönköping', 14.16, 57.78],
  ]),
  finland: R('Finland', ['Helsinki', 24.94, 60.17], [
    ['Tampere', 23.76, 61.5], ['Turku', 22.27, 60.45], ['Oulu', 25.47, 65.01], ['Rovaniemi', 25.73, 66.5],
    ['Kuopio', 27.68, 62.89], ['Jyväskylä', 25.75, 62.24], ['Vaasa', 21.62, 63.1], ['Joensuu', 29.76, 62.6],
    ['Lahti', 25.66, 60.98], ['Kajaani', 27.73, 64.23], ['Ivalo', 27.54, 68.66], ['Mariehamn', 19.94, 60.1],
  ]),
  iceland: R('Iceland', ['Reykjavík', -21.94, 64.15], [
    ['Akureyri', -18.09, 65.68], ['Ísafjörður', -23.12, 66.07], ['Egilsstaðir', -14.4, 65.26], ['Höfn', -15.21, 64.25],
    ['Vík', -19.01, 63.42], ['Selfoss', -21.0, 63.93], ['Húsavík', -17.34, 66.04], ['Stykkishólmur', -22.73, 65.07],
  ]),
  ireland: R('Ireland', ['Dublin', -6.26, 53.35], [
    ['Cork', -8.47, 51.9], ['Galway', -9.05, 53.27], ['Limerick', -8.63, 52.66], ['Waterford', -7.11, 52.26],
    ['Sligo', -8.48, 54.27], ['Killarney', -9.51, 52.06], ['Letterkenny', -7.73, 54.95], ['Athlone', -7.94, 53.42],
  ]),
  belarus: R('Belarus', ['Minsk', 27.56, 53.9], [
    ['Gomel', 30.98, 52.44], ['Mogilev', 30.33, 53.9], ['Vitebsk', 30.2, 55.19], ['Grodno', 23.83, 53.68],
    ['Pinsk', 26.1, 52.11], ['Babruysk', 29.22, 53.14], ['Baranovichi', 26.01, 53.13], ['Polotsk', 28.79, 55.49],
  ]),
  ukraine: R('Ukraine', ['Kyiv', 30.52, 50.45], [
    ['Kharkiv', 36.23, 49.99], ['Odesa', 30.72, 46.48], ['Dnipro', 35.05, 48.46], ['Lviv', 24.03, 49.84],
    ['Zaporizhzhia', 35.14, 47.84], ['Donetsk', 37.8, 48.02], ['Mariupol', 37.55, 47.1], ['Mykolaiv', 31.99, 46.98],
    ['Vinnytsia', 28.47, 49.23], ['Chernihiv', 31.29, 51.49], ['Poltava', 34.55, 49.59], ['Kherson', 32.62, 46.64],
    ['Sevastopol', 33.52, 44.62], ['Simferopol', 34.1, 44.95], ['Luhansk', 39.31, 48.57], ['Uzhhorod', 22.29, 48.62],
    ['Chernivtsi', 25.94, 48.29], ['Rivne', 26.25, 50.62], ['Sumy', 34.8, 50.91], ['Kryvyi Rih', 33.39, 47.91],
  ]),
  moldova: R('Moldova', ['Chișinău', 28.86, 47.01], [
    ['Bălți', 27.93, 47.76], ['Tiraspol', 29.6, 46.84], ['Cahul', 28.19, 45.9], ['Soroca', 28.3, 48.16],
  ]),
  romania: R('Romania', ['Bucharest', 26.1, 44.43], [
    ['Cluj-Napoca', 23.59, 46.77], ['Timișoara', 21.23, 45.75], ['Iași', 27.6, 47.16], ['Constanța', 28.63, 44.17],
    ['Brașov', 25.61, 45.66], ['Craiova', 23.8, 44.32], ['Galați', 28.05, 45.44], ['Oradea', 21.92, 47.07],
    ['Sibiu', 24.15, 45.79], ['Suceava', 26.25, 47.65], ['Baia Mare', 23.58, 47.66], ['Târgu Mureș', 24.56, 46.54],
    ['Tulcea', 28.8, 45.18], ['Drobeta-Turnu Severin', 22.66, 44.63], ['Arad', 21.31, 46.17],
  ]),
  bulgaria: R('Bulgaria', ['Sofia', 23.32, 42.7], [
    ['Plovdiv', 24.75, 42.14], ['Varna', 27.91, 43.21], ['Burgas', 27.47, 42.5], ['Ruse', 25.97, 43.85],
    ['Stara Zagora', 25.63, 42.43], ['Pleven', 24.62, 43.42], ['Veliko Tarnovo', 25.63, 43.08], ['Vidin', 22.88, 43.99],
    ['Blagoevgrad', 23.1, 42.02], ['Shumen', 26.93, 43.27],
  ]),
  serbia: R('Serbia', ['Belgrade', 20.46, 44.79], [
    ['Novi Sad', 19.83, 45.27], ['Niš', 21.9, 43.32], ['Kragujevac', 20.92, 44.01], ['Subotica', 19.67, 46.1],
    ['Zrenjanin', 20.39, 45.38], ['Čačak', 20.35, 43.89], ['Novi Pazar', 20.51, 43.14], ['Kraljevo', 20.69, 43.72],
  ]),
  croatia: R('Croatia', ['Zagreb', 15.98, 45.81], [
    ['Split', 16.44, 43.51], ['Rijeka', 14.44, 45.33], ['Osijek', 18.69, 45.55], ['Zadar', 15.23, 44.12],
    ['Dubrovnik', 18.09, 42.65], ['Pula', 13.85, 44.87], ['Šibenik', 15.89, 43.73], ['Varaždin', 16.34, 46.31],
  ]),
  slovenia: R('Slovenia', ['Ljubljana', 14.51, 46.06], [
    ['Maribor', 15.65, 46.55], ['Celje', 15.27, 46.24], ['Koper', 13.73, 45.55], ['Kranj', 14.36, 46.24],
    ['Novo Mesto', 15.17, 45.8], ['Nova Gorica', 13.65, 45.96],
  ]),
  bosnia: R('Bosnia and Herzegovina', ['Sarajevo', 18.41, 43.86], [
    ['Banja Luka', 17.19, 44.77], ['Tuzla', 18.67, 44.54], ['Zenica', 17.91, 44.2], ['Mostar', 17.81, 43.34],
    ['Bihać', 15.87, 44.82], ['Trebinje', 18.34, 42.71], ['Bijeljina', 19.21, 44.76],
  ]),
  montenegro: R('Montenegro', ['Podgorica', 19.26, 42.44], [
    ['Nikšić', 18.94, 42.77], ['Bar', 19.1, 42.09], ['Kotor', 18.77, 42.42], ['Pljevlja', 19.36, 43.36], ['Ulcinj', 19.21, 41.93],
  ]),
  albania: R('Albania', ['Tirana', 19.82, 41.33], [
    ['Durrës', 19.45, 41.32], ['Vlorë', 19.49, 40.47], ['Shkodër', 19.51, 42.07], ['Elbasan', 20.08, 41.11],
    ['Korçë', 20.78, 40.62], ['Gjirokastër', 20.14, 40.08], ['Sarandë', 20.0, 39.88], ['Kukës', 20.42, 42.08],
  ]),
  'north-macedonia': R('North Macedonia', ['Skopje', 21.43, 42.0], [
    ['Bitola', 21.34, 41.03], ['Kumanovo', 21.71, 42.13], ['Prilep', 21.55, 41.35], ['Tetovo', 20.97, 42.01],
    ['Ohrid', 20.8, 41.12], ['Štip', 22.2, 41.74], ['Strumica', 22.64, 41.44],
  ]),
  greece: R('Greece', ['Athens', 23.73, 37.98], [
    ['Thessaloniki', 22.94, 40.64], ['Patras', 21.73, 38.25], ['Heraklion', 25.13, 35.34], ['Larissa', 22.42, 39.64],
    ['Ioannina', 20.85, 39.66], ['Volos', 22.94, 39.36], ['Kavala', 24.41, 40.94], ['Chania', 24.02, 35.51],
    ['Rhodes', 28.22, 36.43], ['Alexandroupoli', 25.87, 40.85], ['Kalamata', 22.11, 37.04], ['Corfu', 19.92, 39.62],
    ['Mytilene', 26.55, 39.11], ['Kozani', 21.79, 40.3],
  ]),
  estonia: R('Estonia', ['Tallinn', 24.75, 59.44], [
    ['Tartu', 26.72, 58.38], ['Pärnu', 24.5, 58.39], ['Narva', 28.19, 59.38], ['Kuressaare', 22.49, 58.25],
    ['Haapsalu', 23.54, 58.94], ['Viljandi', 25.59, 58.36],
  ]),
  latvia: R('Latvia', ['Riga', 24.11, 56.95], [
    ['Daugavpils', 26.53, 55.87], ['Liepāja', 21.01, 56.51], ['Jelgava', 23.72, 56.65], ['Ventspils', 21.57, 57.39],
    ['Rēzekne', 27.33, 56.51], ['Valmiera', 25.43, 57.54],
  ]),
  lithuania: R('Lithuania', ['Vilnius', 25.28, 54.69], [
    ['Kaunas', 23.9, 54.9], ['Klaipėda', 21.14, 55.7], ['Šiauliai', 23.32, 55.93], ['Panevėžys', 24.36, 55.73],
    ['Alytus', 24.05, 54.4], ['Utena', 25.6, 55.5],
  ]),

  // ------------------------------------------------------------ Africa
  egypt: R('Egypt', ['Cairo', 31.24, 30.04], [
    ['Alexandria', 29.92, 31.2], ['Luxor', 32.64, 25.69], ['Aswan', 32.9, 24.09], ['Port Said', 32.3, 31.26],
    ['Suez', 32.55, 29.97], ['Asyut', 31.18, 27.18], ['Mansoura', 31.38, 31.04], ['Hurghada', 33.81, 27.26],
    ['Sharm El Sheikh', 34.33, 27.92], ['Marsa Matruh', 27.24, 31.35], ['Siwa', 25.52, 29.2], ['El Arish', 33.8, 31.13],
    ['Minya', 30.75, 28.1], ['Faiyum', 30.84, 29.31], ['Tanta', 31.0, 30.79], ['Sohag', 31.69, 26.56],
    ['Kharga', 30.55, 25.44], ['Marsa Alam', 34.89, 25.07], ['Damietta', 31.81, 31.42], ['Ismailia', 32.27, 30.6],
  ]),
  libya: R('Libya', ['Tripoli', 13.19, 32.89], [
    ['Benghazi', 20.07, 32.12], ['Misrata', 15.09, 32.38], ['Sabha', 14.43, 27.04], ['Tobruk', 23.96, 32.08],
    ['Sirte', 16.59, 31.21], ['Derna', 22.64, 32.76], ['Kufra', 23.31, 24.18], ['Ghadames', 9.5, 30.13],
    ['Zuwara', 12.08, 32.93], ['Ajdabiya', 20.23, 30.76], ['Bayda', 21.76, 32.76], ['Ghat', 10.17, 24.96],
    ['Murzuk', 13.92, 25.92], ['Zawiya', 12.73, 32.76],
  ]),
  tunisia: R('Tunisia', ['Tunis', 10.18, 36.81], [
    ['Sfax', 10.76, 34.74], ['Sousse', 10.64, 35.83], ['Kairouan', 10.1, 35.68], ['Bizerte', 9.87, 37.27],
    ['Gabès', 10.1, 33.88], ['Gafsa', 8.78, 34.43], ['Tozeur', 8.13, 33.92], ['Houmt Souk', 10.86, 33.88],
    ['Medenine', 10.5, 33.35], ['Tataouine', 10.45, 32.93], ['Kasserine', 8.84, 35.17], ['Jendouba', 8.78, 36.5],
  ]),
  algeria: R('Algeria', ['Algiers', 3.06, 36.75], [
    ['Oran', -0.63, 35.7], ['Constantine', 6.61, 36.37], ['Annaba', 7.77, 36.9], ['Tamanrasset', 5.52, 22.79],
    ['Ghardaïa', 3.67, 32.49], ['Béjaïa', 5.08, 36.75], ['Sétif', 5.41, 36.19], ['Tlemcen', -1.32, 34.88],
    ['Batna', 6.17, 35.56], ['Biskra', 5.73, 34.85], ['Ouargla', 5.33, 31.95], ['Béchar', -2.22, 31.62],
    ['Tindouf', -8.15, 27.67], ['In Salah', 2.47, 27.2], ['Djanet', 9.48, 24.55], ['Adrar', -0.29, 27.87],
    ['El Oued', 6.86, 33.37], ['Laghouat', 2.88, 33.8], ['Skikda', 6.91, 36.88], ['Mostaganem', 0.09, 35.93],
  ]),
  morocco: R('Morocco', ['Rabat', -6.84, 34.02], [
    ['Casablanca', -7.59, 33.57], ['Marrakesh', -7.99, 31.63], ['Fez', -5.0, 34.03], ['Tangier', -5.81, 35.76],
    ['Agadir', -9.6, 30.43], ['Oujda', -1.91, 34.68], ['Meknes', -5.55, 33.9], ['Tetouan', -5.37, 35.57],
    ['Ouarzazate', -6.89, 30.92], ['Essaouira', -9.77, 31.51], ['Nador', -2.93, 35.17], ['Errachidia', -4.42, 31.93],
    ['Safi', -9.24, 32.3], ['El Jadida', -8.5, 33.23],
  ]),
  mauritania: R('Mauritania', ['Nouakchott', -15.98, 18.09], [
    ['Nouadhibou', -17.04, 20.94], ['Atar', -13.05, 20.52], ['Kiffa', -11.4, 16.62], ['Néma', -7.26, 16.62],
    ['Zouérat', -12.47, 22.74], ['Rosso', -15.8, 16.51], ['Kaédi', -13.5, 16.15],
  ]),
  mali: R('Mali', ['Bamako', -8.0, 12.64], [
    ['Timbuktu', -3.0, 16.77], ['Gao', -0.04, 16.27], ['Mopti', -4.2, 14.49], ['Kayes', -11.43, 14.45],
    ['Ségou', -6.26, 13.43], ['Sikasso', -5.67, 11.32], ['Kidal', 1.41, 18.44], ['Taoudenni', -3.98, 22.68],
    ['Ménaka', 2.4, 15.92], ['Djenné', -4.55, 13.91], ['Nioro du Sahel', -9.59, 15.23],
  ]),
  niger: R('Niger', ['Niamey', 2.11, 13.51], [
    ['Zinder', 8.99, 13.81], ['Maradi', 7.1, 13.5], ['Agadez', 7.99, 16.97], ['Tahoua', 5.27, 14.89],
    ['Diffa', 12.61, 13.32], ['Arlit', 7.38, 18.74], ['Dosso', 3.19, 13.05], ['Bilma', 12.92, 18.69],
  ]),
  chad: R('Chad', ["N'Djamena", 15.04, 12.13], [
    ['Moundou', 16.08, 8.57], ['Abéché', 20.83, 13.83], ['Sarh', 18.39, 9.14], ['Faya-Largeau', 19.11, 17.92],
    ['Mongo', 18.69, 12.18], ['Bol', 14.71, 13.46], ['Am Timan', 20.28, 10.98],
  ]),
  sudan: R('Sudan', ['Khartoum', 32.53, 15.5], [
    ['Port Sudan', 37.22, 19.62], ['Kassala', 36.4, 15.45], ['El Obeid', 30.22, 13.18], ['Nyala', 24.88, 12.05],
    ['Wad Madani', 33.52, 14.4], ['El Fasher', 25.35, 13.63], ['Atbara', 33.98, 17.7], ['Dongola', 30.48, 19.18],
    ['Kadugli', 29.72, 11.01], ['Wadi Halfa', 31.35, 21.8], ['Geneina', 22.45, 13.45], ['Gedaref', 35.38, 14.03],
  ]),
  'south-sudan': R('South Sudan', ['Juba', 31.58, 4.85], [
    ['Malakal', 31.66, 9.53], ['Wau', 28.0, 7.7], ['Bor', 31.56, 6.21], ['Rumbek', 29.69, 6.8], ['Yambio', 28.4, 4.57],
    ['Aweil', 27.4, 8.77],
  ]),
  ethiopia: R('Ethiopia', ['Addis Ababa', 38.76, 9.03], [
    ['Dire Dawa', 41.87, 9.59], ['Mekelle', 39.47, 13.5], ['Gondar', 37.47, 12.61], ['Bahir Dar', 37.39, 11.59],
    ['Hawassa', 38.48, 7.06], ['Jimma', 36.83, 7.67], ['Harar', 42.12, 9.31], ['Dessie', 39.63, 11.13],
    ['Gambela', 34.59, 8.25], ['Jijiga', 42.8, 9.35], ['Aksum', 38.72, 14.13], ['Arba Minch', 37.55, 6.04],
    ['Nekemte', 36.55, 9.08],
  ]),
  somalia: R('Somalia', ['Mogadishu', 45.32, 2.05], [
    ['Hargeisa', 44.06, 9.56], ['Bosaso', 49.18, 11.28], ['Kismayo', 42.55, -0.36], ['Galkayo', 47.43, 6.77],
    ['Berbera', 45.01, 10.44], ['Baidoa', 43.65, 3.11], ['Garowe', 48.48, 8.41], ['Beledweyne', 45.2, 4.74],
  ]),
  kenya: R('Kenya', ['Nairobi', 36.82, -1.29], [
    ['Mombasa', 39.67, -4.04], ['Kisumu', 34.76, -0.09], ['Nakuru', 36.07, -0.3], ['Eldoret', 35.27, 0.51],
    ['Garissa', 39.64, -0.45], ['Lamu', 40.9, -2.27], ['Lodwar', 35.6, 3.12], ['Malindi', 40.12, -3.22],
    ['Marsabit', 37.99, 2.33], ['Meru', 37.65, 0.05], ['Wajir', 40.06, 1.75], ['Kitale', 35.01, 1.02],
  ]),
  uganda: R('Uganda', ['Kampala', 32.58, 0.35], [
    ['Gulu', 32.3, 2.77], ['Mbarara', 30.66, -0.61], ['Jinja', 33.2, 0.42], ['Mbale', 34.18, 1.08], ['Arua', 30.91, 3.02],
    ['Fort Portal', 30.27, 0.67], ['Lira', 32.9, 2.25], ['Kasese', 30.09, 0.18],
  ]),
  tanzania: R('Tanzania', ['Dodoma', 35.75, -6.16], [
    ['Dar es Salaam', 39.27, -6.79], ['Mwanza', 32.9, -2.52], ['Arusha', 36.68, -3.39], ['Zanzibar City', 39.2, -6.16],
    ['Mbeya', 33.46, -8.9], ['Tanga', 39.1, -5.07], ['Morogoro', 37.66, -6.82], ['Kigoma', 29.63, -4.88],
    ['Tabora', 32.8, -5.02], ['Mtwara', 40.18, -10.27], ['Iringa', 35.69, -7.77], ['Songea', 35.65, -10.68],
    ['Moshi', 37.34, -3.35], ['Musoma', 33.8, -1.5], ['Sumbawanga', 31.62, -7.97], ['Shinyanga', 33.42, -3.66],
  ]),
  nigeria: R('Nigeria', ['Abuja', 7.4, 9.08], [
    ['Lagos', 3.38, 6.52], ['Kano', 8.52, 12.0], ['Ibadan', 3.9, 7.38], ['Port Harcourt', 7.03, 4.82],
    ['Benin City', 5.63, 6.34], ['Kaduna', 7.44, 10.52], ['Maiduguri', 13.16, 11.85], ['Enugu', 7.51, 6.45],
    ['Sokoto', 5.24, 13.06], ['Jos', 8.89, 9.9], ['Calabar', 8.32, 4.95], ['Ilorin', 4.55, 8.5], ['Yola', 12.47, 9.21],
  ]),
  ghana: R('Ghana', ['Accra', -0.19, 5.6], [
    ['Kumasi', -1.62, 6.69], ['Tamale', -0.84, 9.4], ['Takoradi', -1.76, 4.9], ['Cape Coast', -1.25, 5.11],
    ['Sunyani', -2.33, 7.34], ['Ho', 0.47, 6.6], ['Bolgatanga', -0.85, 10.79], ['Wa', -2.5, 10.06],
  ]),
  'ivory-coast': R('Ivory Coast', ['Yamoussoukro', -5.28, 6.82], [
    ['Abidjan', -4.01, 5.36], ['Bouaké', -5.03, 7.69], ['Korhogo', -5.63, 9.46], ['San-Pédro', -6.64, 4.75],
    ['Man', -7.55, 7.41], ['Daloa', -6.45, 6.88],
  ]),
  senegal: R('Senegal', ['Dakar', -17.45, 14.69], [
    ['Saint-Louis', -16.49, 16.03], ['Touba', -15.88, 14.85], ['Thiès', -16.93, 14.79], ['Ziguinchor', -16.27, 12.58],
    ['Kaolack', -16.07, 14.15], ['Tambacounda', -13.67, 13.77], ['Kolda', -14.94, 12.89], ['Kédougou', -12.18, 12.56],
  ]),
  cameroon: R('Cameroon', ['Yaoundé', 11.52, 3.85], [
    ['Douala', 9.7, 4.05], ['Garoua', 13.4, 9.3], ['Maroua', 14.32, 10.59], ['Bamenda', 10.15, 5.96],
    ['Ngaoundéré', 13.58, 7.32], ['Bertoua', 13.68, 4.58], ['Kribi', 9.91, 2.94], ['Ebolowa', 11.15, 2.91],
  ]),
  'central-african-republic': R('Central African Republic', ['Bangui', 18.56, 4.36], [
    ['Berbérati', 15.79, 4.26], ['Bambari', 20.67, 5.76], ['Bossangoa', 17.45, 6.49], ['Ndélé', 20.65, 8.41],
    ['Bria', 21.99, 6.54], ['Obo', 26.49, 5.4],
  ]),
  'dr-congo': R('DR Congo', ['Kinshasa', 15.31, -4.32], [
    ['Lubumbashi', 27.48, -11.66], ['Kisangani', 25.19, 0.52], ['Mbuji-Mayi', 23.59, -6.14], ['Kananga', 22.42, -5.9],
    ['Goma', 29.22, -1.68], ['Bukavu', 28.86, -2.51], ['Mbandaka', 18.26, 0.05], ['Kolwezi', 25.47, -10.72],
    ['Matadi', 13.46, -5.82], ['Kalemie', 29.19, -5.95], ['Kindu', 25.92, -2.95], ['Bunia', 30.25, 1.56],
    ['Gemena', 19.77, 3.26], ['Isiro', 27.62, 2.77], ['Bandundu', 17.37, -3.32], ['Kikwit', 18.82, -5.04],
  ]),
  angola: R('Angola', ['Luanda', 13.23, -8.84], [
    ['Huambo', 15.74, -12.78], ['Lobito', 13.55, -12.36], ['Lubango', 13.49, -14.92], ['Malanje', 16.34, -9.54],
    ['Namibe', 12.15, -15.2], ['Saurimo', 20.39, -9.66], ['Cabinda', 12.2, -5.55], ['Menongue', 17.69, -14.66],
    ['Luena', 19.92, -11.78], ['Uíge', 15.06, -7.61], ['Kuito', 16.93, -12.38], ['Ondjiva', 15.73, -17.07],
  ]),
  zambia: R('Zambia', ['Lusaka', 28.32, -15.39], [
    ['Ndola', 28.64, -12.96], ['Kitwe', 28.21, -12.8], ['Livingstone', 25.85, -17.84], ['Kabwe', 28.45, -14.45],
    ['Chipata', 32.65, -13.64], ['Mongu', 23.13, -15.25], ['Kasama', 31.18, -10.21], ['Solwezi', 26.39, -12.18],
  ]),
  zimbabwe: R('Zimbabwe', ['Harare', 31.05, -17.83], [
    ['Bulawayo', 28.58, -20.15], ['Mutare', 32.67, -18.97], ['Gweru', 29.82, -19.45], ['Masvingo', 30.83, -20.07],
    ['Victoria Falls', 25.84, -17.93], ['Hwange', 26.5, -18.37], ['Kariba', 28.8, -16.52],
  ]),
  mozambique: R('Mozambique', ['Maputo', 32.57, -25.97], [
    ['Beira', 34.84, -19.84], ['Nampula', 39.27, -15.12], ['Quelimane', 36.89, -17.88], ['Tete', 33.59, -16.16],
    ['Pemba', 40.52, -12.97], ['Lichinga', 35.24, -13.31], ['Inhambane', 35.38, -23.87], ['Chimoio', 33.48, -19.12],
    ['Xai-Xai', 33.64, -25.05], ['Nacala', 40.67, -14.54],
  ]),
  namibia: R('Namibia', ['Windhoek', 17.08, -22.56], [
    ['Walvis Bay', 14.51, -22.96], ['Swakopmund', 14.53, -22.68], ['Lüderitz', 15.16, -26.65], ['Rundu', 19.77, -17.92],
    ['Keetmanshoop', 18.13, -26.58], ['Oshakati', 15.7, -17.79], ['Katima Mulilo', 24.27, -17.5], ['Tsumeb', 17.72, -19.25],
  ]),
  botswana: R('Botswana', ['Gaborone', 25.91, -24.65], [
    ['Francistown', 27.51, -21.17], ['Maun', 23.42, -19.98], ['Kasane', 25.15, -17.82], ['Ghanzi', 21.78, -21.7],
    ['Serowe', 26.71, -22.39], ['Tsabong', 22.4, -26.02],
  ]),
  'south-africa': R('South Africa', ['Pretoria', 28.19, -25.75], [
    ['Cape Town', 18.42, -33.92], ['Durban', 31.02, -29.86], ['Johannesburg', 28.05, -26.2], ['Gqeberha', 25.6, -33.96],
    ['Bloemfontein', 26.21, -29.09], ['East London', 27.91, -33.02], ['Kimberley', 24.76, -28.74], ['Polokwane', 29.45, -23.9],
    ['Upington', 21.26, -28.45], ['Mbombela', 30.97, -25.47], ['George', 22.46, -33.96], ['Pietermaritzburg', 30.38, -29.6],
    ['Springbok', 17.88, -29.66], ['Mthatha', 28.78, -31.59], ['Richards Bay', 32.04, -28.78],
  ]),
  madagascar: R('Madagascar', ['Antananarivo', 47.52, -18.88], [
    ['Toamasina', 49.4, -18.15], ['Mahajanga', 46.32, -15.72], ['Toliara', 43.67, -23.35], ['Antsiranana', 49.29, -12.28],
    ['Fianarantsoa', 47.09, -21.45], ['Taolagnaro', 46.98, -25.03], ['Morondava', 44.28, -20.28], ['Antsirabe', 47.03, -19.87],
    ['Sambava', 50.17, -14.27], ['Maintirano', 44.03, -18.06],
  ]),

  // ------------------------------------------------------------ Oceania
  australia: R('Australia', ['Canberra', 149.13, -35.28], [
    ['Sydney', 151.21, -33.87], ['Melbourne', 144.96, -37.81], ['Perth', 115.86, -31.95], ['Brisbane', 153.03, -27.47],
    ['Adelaide', 138.6, -34.93], ['Darwin', 130.84, -12.46], ['Hobart', 147.33, -42.88], ['Cairns', 145.77, -16.92],
    ['Townsville', 146.82, -19.26], ['Alice Springs', 133.88, -23.7], ['Gold Coast', 153.4, -28.02], ['Broome', 122.24, -17.96],
    ['Port Hedland', 118.61, -20.31], ['Kalgoorlie', 121.47, -30.75], ['Mount Isa', 139.49, -20.73], ['Geraldton', 114.61, -28.78],
    ['Rockhampton', 150.51, -23.38], ['Mackay', 149.19, -21.14], ['Esperance', 121.89, -33.86], ['Carnarvon', 113.66, -24.88],
    ['Katherine', 132.26, -14.47], ['Tennant Creek', 134.19, -19.65], ['Port Augusta', 137.77, -32.49], ['Coober Pedy', 134.75, -29.01],
    ['Launceston', 147.14, -41.44], ['Wagga Wagga', 147.37, -35.12], ['Dubbo', 148.6, -32.25], ['Mildura', 142.16, -34.19],
    ['Weipa', 141.87, -12.63], ['Karratha', 116.85, -20.74], ['Ceduna', 133.67, -32.13], ['Longreach', 144.25, -23.44],
    ['Broken Hill', 141.47, -31.95], ['Kununurra', 128.74, -15.77], ['Albany', 117.88, -35.02], ['Bunbury', 115.64, -33.33],
  ]),
  'new-zealand': R('New Zealand', ['Wellington', 174.78, -41.29], [
    ['Auckland', 174.76, -36.85], ['Christchurch', 172.64, -43.53], ['Dunedin', 170.5, -45.87], ['Hamilton', 175.28, -37.79],
    ['Queenstown', 168.66, -45.03], ['Invercargill', 168.35, -46.41], ['Napier', 176.92, -39.49], ['Nelson', 173.28, -41.27],
    ['Tauranga', 176.17, -37.69], ['Rotorua', 176.25, -38.14], ['Whangārei', 174.32, -35.73], ['Greymouth', 171.21, -42.45],
    ['New Plymouth', 174.08, -39.06], ['Gisborne', 178.02, -38.66], ['Timaru', 171.25, -44.4],
  ]),

  // ------------------------------------------------------------ North America
  'united-states': R('United States', ['Washington', -77.04, 38.9], [
    ['New York', -74.01, 40.71], ['Los Angeles', -118.24, 34.05], ['Chicago', -87.63, 41.88], ['Houston', -95.37, 29.76],
    ['San Francisco', -122.42, 37.77], ['Seattle', -122.33, 47.61], ['Miami', -80.19, 25.76], ['Denver', -104.99, 39.74],
    ['Atlanta', -84.39, 33.75], ['Dallas', -96.8, 32.78], ['Phoenix', -112.07, 33.45], ['Boston', -71.06, 42.36],
    ['Minneapolis', -93.27, 44.98], ['Salt Lake City', -111.89, 40.76], ['New Orleans', -90.07, 29.95], ['Anchorage', -149.9, 61.22],
    ['Honolulu', -157.86, 21.31], ['Philadelphia', -75.17, 39.95], ['Detroit', -83.05, 42.33], ['St. Louis', -90.2, 38.63],
    ['Kansas City', -94.58, 39.1], ['Las Vegas', -115.14, 36.17], ['Portland', -122.68, 45.52], ['San Diego', -117.16, 32.72],
    ['Nashville', -86.78, 36.16], ['Albuquerque', -106.65, 35.08], ['El Paso', -106.49, 31.76], ['Oklahoma City', -97.52, 35.47],
    ['Charlotte', -80.84, 35.23], ['Jacksonville', -81.66, 30.33], ['Billings', -108.5, 45.78], ['Boise', -116.2, 43.62],
    ['Fairbanks', -147.72, 64.84], ['Juneau', -134.42, 58.3], ['Pittsburgh', -79.99, 40.44], ['Cleveland', -81.69, 41.5],
    ['Omaha', -95.94, 41.26], ['San Antonio', -98.49, 29.42], ['Memphis', -90.05, 35.15], ['Tampa', -82.46, 27.95],
    ['Sacramento', -121.49, 38.58], ['Spokane', -117.43, 47.66], ['Bismarck', -100.78, 46.81], ['Cheyenne', -104.82, 41.14],
    ['Buffalo', -78.88, 42.89], ['Milwaukee', -87.91, 43.04], ['Tucson', -110.97, 32.22], ['Reno', -119.81, 39.53],
    ['Rapid City', -103.23, 44.08], ['Duluth', -92.1, 46.79], ['Raleigh', -78.64, 35.78],
    ['Savannah', -81.1, 32.08], ['Corpus Christi', -97.4, 27.8], ['Little Rock', -92.29, 34.75], ['Des Moines', -93.61, 41.59],
    ['Nome', -165.41, 64.5], ['Utqiagvik', -156.79, 71.29], ['Bethel', -161.76, 60.79], ['Hilo', -155.09, 19.72],
    ['San Juan', -66.11, 18.47], ['Ponce', -66.61, 18.01], ['Mayagüez', -67.14, 18.2], ['Arecibo', -66.72, 18.47],
    ['Humacao', -65.83, 18.15], ['Aguadilla', -67.15, 18.43], ['Fajardo', -65.65, 18.33],
  ]),
  canada: R('Canada', ['Ottawa', -75.7, 45.42], [
    ['Toronto', -79.38, 43.65], ['Vancouver', -123.12, 49.28], ['Montreal', -73.57, 45.5], ['Calgary', -114.07, 51.05],
    ['Edmonton', -113.49, 53.55], ['Winnipeg', -97.14, 49.9], ['Quebec City', -71.21, 46.81], ['Halifax', -63.57, 44.65],
    ['Regina', -104.62, 50.45], ['Saskatoon', -106.67, 52.13], ["St. John's", -52.71, 47.56], ['Thunder Bay', -89.25, 48.38],
    ['Whitehorse', -135.06, 60.72], ['Yellowknife', -114.37, 62.45], ['Iqaluit', -68.52, 63.75], ['Victoria', -123.37, 48.43],
    ['Fredericton', -66.64, 45.96], ['Charlottetown', -63.13, 46.24], ['Prince George', -122.75, 53.92], ['Fort McMurray', -111.38, 56.73],
    ['Churchill', -94.17, 58.77], ['Inuvik', -133.72, 68.36], ['Sudbury', -80.99, 46.49], ['Kelowna', -119.5, 49.89],
    ['Moncton', -64.78, 46.09], ['Saguenay', -71.07, 48.43], ['Sept-Îles', -66.38, 50.21], ['Kuujjuaq', -68.4, 58.1],
    ['Rankin Inlet', -92.08, 62.81], ['Cambridge Bay', -105.06, 69.12], ['Happy Valley-Goose Bay', -60.33, 53.3], ['Timmins', -81.33, 48.48],
    ['Prince Rupert', -130.32, 54.32], ['Lethbridge', -112.84, 49.69], ['Gander', -54.61, 48.95], ['Sault Ste. Marie', -84.33, 46.52],
    ['Windsor', -83.03, 42.31], ['Fort Nelson', -122.7, 58.81], ['Hay River', -115.8, 60.82], ['Baker Lake', -96.03, 64.32],
    ['Moosonee', -80.65, 51.27], ['Chibougamau', -74.37, 49.91], ['Dawson City', -139.43, 64.06], ['Pond Inlet', -77.96, 72.7],
  ]),
  mexico: R('Mexico', ['Mexico City', -99.13, 19.43], [
    ['Guadalajara', -103.35, 20.67], ['Monterrey', -100.32, 25.69], ['Tijuana', -117.04, 32.51], ['Mérida', -89.62, 20.97],
    ['Puebla', -98.21, 19.04], ['Ciudad Juárez', -106.49, 31.69], ['León', -101.68, 21.12], ['Cancún', -86.85, 21.16],
    ['Acapulco', -99.89, 16.86], ['Veracruz', -96.13, 19.17], ['Chihuahua', -106.09, 28.63], ['Hermosillo', -110.96, 29.07],
    ['Oaxaca', -96.73, 17.07], ['Culiacán', -107.39, 24.81], ['Mazatlán', -106.41, 23.25], ['Tampico', -97.86, 22.25],
    ['Durango', -104.67, 24.02], ['San Luis Potosí', -100.98, 22.15], ['Aguascalientes', -102.29, 21.88], ['Querétaro', -100.39, 20.59],
    ['Morelia', -101.19, 19.7], ['Villahermosa', -92.93, 17.99], ['Tuxtla Gutiérrez', -93.12, 16.75], ['Saltillo', -101.0, 25.42],
    ['Torreón', -103.41, 25.54], ['Campeche', -90.53, 19.85], ['Chetumal', -88.3, 18.5], ['Ensenada', -116.6, 31.87],
    ['Mexicali', -115.45, 32.62], ['Nuevo Laredo', -99.51, 27.48], ['Matamoros', -97.5, 25.87], ['Zacatecas', -102.57, 22.77],
    ['Puerto Vallarta', -105.23, 20.65], ['Los Mochis', -108.99, 25.79], ['Guaymas', -110.9, 27.92], ['Tepic', -104.89, 21.5],
    ['Cabo San Lucas', -109.92, 22.89], ['Santa Rosalía', -112.27, 27.34], ['Ciudad Victoria', -99.14, 23.74], ['Xalapa', -96.92, 19.54],
    ['Tapachula', -92.26, 14.9],
  ]),
  guatemala: R('Guatemala', ['Guatemala City', -90.51, 14.63], [
    ['Quetzaltenango', -91.52, 14.84], ['Escuintla', -90.79, 14.3], ['Cobán', -90.37, 15.47], ['Flores', -89.89, 16.93],
    ['Puerto Barrios', -88.59, 15.73], ['Huehuetenango', -91.47, 15.32], ['Chiquimula', -89.54, 14.8],
  ]),
  belize: R('Belize', ['Belmopan', -88.76, 17.25], [
    ['Belize City', -88.19, 17.5], ['San Ignacio', -89.07, 17.16], ['Orange Walk', -88.56, 18.08], ['Dangriga', -88.22, 16.97],
    ['Punta Gorda', -88.81, 16.1], ['Corozal', -88.39, 18.39],
  ]),
  honduras: R('Honduras', ['Tegucigalpa', -87.21, 14.07], [
    ['San Pedro Sula', -88.03, 15.5], ['La Ceiba', -86.78, 15.76], ['Choluteca', -87.19, 13.3], ['Comayagua', -87.64, 14.45],
    ['Puerto Lempira', -83.78, 15.27], ['Juticalpa', -86.22, 14.67], ['Santa Rosa de Copán', -88.78, 14.77], ['Roatán', -86.53, 16.32],
  ]),
  'el-salvador': R('El Salvador', ['San Salvador', -89.19, 13.69], [
    ['Santa Ana', -89.56, 13.99], ['San Miguel', -88.18, 13.48], ['La Unión', -87.84, 13.34], ['Sonsonate', -89.72, 13.72],
    ['Chalatenango', -88.94, 14.04],
  ]),
  nicaragua: R('Nicaragua', ['Managua', -86.25, 12.13], [
    ['Granada', -85.96, 11.93], ['Matagalpa', -85.92, 12.93], ['Estelí', -86.35, 13.09], ['Chinandega', -87.13, 12.63],
    ['Bluefields', -83.77, 12.01], ['Puerto Cabezas', -83.38, 14.03], ['Juigalpa', -85.36, 12.11], ['San Carlos', -84.78, 11.12],
  ]),
  'costa-rica': R('Costa Rica', ['San José', -84.09, 9.93], [
    ['Limón', -83.03, 9.99], ['Puntarenas', -84.83, 9.98], ['Liberia', -85.44, 10.63], ['Quepos', -84.16, 9.43],
    ['Golfito', -83.16, 8.64], ['Ciudad Quesada', -84.43, 10.32], ['Nicoya', -85.45, 10.15],
  ]),
  panama: R('Panama', ['Panama City', -79.52, 8.98], [
    ['Colón', -79.9, 9.36], ['David', -82.43, 8.43], ['Santiago de Veraguas', -80.98, 8.1], ['Chitré', -80.43, 7.96],
    ['Bocas del Toro', -82.25, 9.34], ['Penonomé', -80.36, 8.52], ['Yaviza', -77.69, 8.16], ['La Palma', -78.15, 8.4],
  ]),
  cuba: R('Cuba', ['Havana', -82.37, 23.11], [
    ['Santiago de Cuba', -75.82, 20.02], ['Camagüey', -77.92, 21.38], ['Holguín', -76.26, 20.89], ['Santa Clara', -79.96, 22.41],
    ['Cienfuegos', -80.44, 22.15], ['Pinar del Río', -83.7, 22.42], ['Matanzas', -81.58, 23.04], ['Guantánamo', -75.21, 20.14],
    ['Bayamo', -76.64, 20.38], ['Las Tunas', -76.95, 20.96], ['Trinidad', -79.98, 21.8], ['Ciego de Ávila', -78.76, 21.84],
    ['Nueva Gerona', -82.8, 21.88], ['Baracoa', -74.5, 20.35],
  ]),
  jamaica: R('Jamaica', ['Kingston', -76.79, 17.97], [
    ['Montego Bay', -77.92, 18.47], ['Mandeville', -77.5, 18.04], ['Ocho Rios', -77.1, 18.41], ['Port Antonio', -76.45, 18.18],
    ['Negril', -78.35, 18.27], ['Savanna-la-Mar', -78.13, 18.22], ['May Pen', -77.25, 17.97],
  ]),
  haiti: R('Haiti', ['Port-au-Prince', -72.34, 18.54], [
    ['Cap-Haïtien', -72.2, 19.76], ['Gonaïves', -72.69, 19.45], ['Les Cayes', -73.75, 18.19], ['Jacmel', -72.54, 18.23],
    ['Jérémie', -74.12, 18.65], ['Port-de-Paix', -72.83, 19.94], ['Hinche', -72.01, 19.15], ['Saint-Marc', -72.69, 19.11],
  ]),
  'dominican-republic': R('Dominican Republic', ['Santo Domingo', -69.93, 18.49], [
    ['Santiago de los Caballeros', -70.7, 19.45], ['La Romana', -68.97, 18.43], ['Puerto Plata', -70.69, 19.79], ['Punta Cana', -68.37, 18.58],
    ['Barahona', -71.1, 18.21], ['San Francisco de Macorís', -70.25, 19.3], ['Samaná', -69.34, 19.21], ['Monte Cristi', -71.65, 19.85],
  ]),
  bahamas: R('Bahamas', ['Nassau', -77.35, 25.05], [
    ['Freeport', -78.7, 26.53], ['Marsh Harbour', -77.06, 26.54], ['George Town', -75.78, 23.51], ['Andros Town', -77.8, 24.7],
    ['Matthew Town', -73.67, 20.95], ['Alice Town', -79.3, 25.73], ['Clarence Town', -74.98, 23.1],
  ]),
  greenland: R('Greenland', ['Nuuk', -51.72, 64.18], [
    ['Sisimiut', -53.67, 66.94], ['Ilulissat', -51.1, 69.22], ['Qaqortoq', -46.03, 60.72], ['Tasiilaq', -37.64, 65.61],
    ['Aasiaat', -52.87, 68.71], ['Upernavik', -56.15, 72.79], ['Qaanaaq', -69.23, 77.47], ['Ittoqqortoormiit', -21.97, 70.49],
    ['Paamiut', -49.67, 61.99], ['Maniitsoq', -52.9, 65.42], ['Uummannaq', -52.13, 70.67], ['Nanortalik', -45.24, 60.14],
  ]),

  // ------------------------------------------------------------ South America
  brazil: R('Brazil', ['Brasília', -47.88, -15.79], [
    ['São Paulo', -46.63, -23.55], ['Rio de Janeiro', -43.17, -22.91], ['Manaus', -60.02, -3.12], ['Salvador', -38.5, -12.97],
    ['Fortaleza', -38.54, -3.73], ['Porto Alegre', -51.23, -30.03], ['Belém', -48.5, -1.46], ['Belo Horizonte', -43.94, -19.92],
    ['Recife', -34.88, -8.05], ['Curitiba', -49.27, -25.43], ['Cuiabá', -56.1, -15.6], ['Porto Velho', -63.9, -8.76],
    ['Goiânia', -49.25, -16.68], ['Campo Grande', -54.62, -20.47], ['São Luís', -44.3, -2.53], ['Natal', -35.21, -5.79],
    ['Teresina', -42.8, -5.09], ['Florianópolis', -48.55, -27.6], ['Vitória', -40.34, -20.32], ['Macapá', -51.07, 0.03],
    ['Boa Vista', -60.67, 2.82], ['Rio Branco', -67.81, -9.97], ['Palmas', -48.33, -10.18], ['Santarém', -54.71, -2.44],
    ['Maceió', -35.73, -9.67], ['Tabatinga', -69.94, -4.25], ['Altamira', -52.21, -3.2], ['Marabá', -49.12, -5.37],
    ['Petrolina', -40.5, -9.39], ['Uberlândia', -48.28, -18.92], ['Pelotas', -52.34, -31.77], ['Corumbá', -57.65, -19.01],
    ['Foz do Iguaçu', -54.59, -25.55], ['Barreiras', -45.0, -12.15], ['Imperatriz', -47.49, -5.53],
  ]),
  argentina: R('Argentina', ['Buenos Aires', -58.38, -34.6], [
    ['Córdoba', -64.18, -31.42], ['Rosario', -60.64, -32.95], ['Mendoza', -68.84, -32.89], ['Tucumán', -65.22, -26.81],
    ['Salta', -65.41, -24.78], ['Mar del Plata', -57.56, -38.0], ['Bahía Blanca', -62.27, -38.72], ['Neuquén', -68.06, -38.95],
    ['Comodoro Rivadavia', -67.5, -45.86], ['Ushuaia', -68.3, -54.8], ['Río Gallegos', -69.22, -51.62], ['Resistencia', -58.99, -27.45],
    ['Posadas', -55.9, -27.37], ['Santa Fe', -60.7, -31.63], ['Corrientes', -58.83, -27.47], ['Bariloche', -71.31, -41.13],
    ['Rawson', -65.1, -43.3], ['Puerto Madryn', -65.04, -42.77], ['Santa Rosa', -64.29, -36.62], ['San Luis', -66.34, -33.3],
    ['La Rioja', -66.86, -29.41], ['Santiago del Estero', -64.26, -27.8], ['Formosa', -58.18, -26.18], ['Jujuy', -65.3, -24.19],
    ['Viedma', -62.99, -40.81], ['El Calafate', -72.27, -50.34],
  ]),
  colombia: R('Colombia', ['Bogotá', -74.07, 4.71], [
    ['Medellín', -75.57, 6.25], ['Cali', -76.53, 3.45], ['Barranquilla', -74.8, 10.96], ['Cartagena', -75.51, 10.39],
    ['Bucaramanga', -73.12, 7.12], ['Cúcuta', -72.51, 7.89], ['Santa Marta', -74.2, 11.24], ['Pasto', -77.28, 1.21],
    ['Villavicencio', -73.63, 4.14], ['Leticia', -69.94, -4.21], ['Montería', -75.88, 8.75], ['Neiva', -75.28, 2.93],
    ['Riohacha', -72.91, 11.54], ['Quibdó', -76.66, 5.69], ['Popayán', -76.61, 2.44], ['Puerto Carreño', -67.49, 6.19],
    ['Mitú', -70.23, 1.25],
  ]),
  venezuela: R('Venezuela', ['Caracas', -66.9, 10.48], [
    ['Maracaibo', -71.64, 10.65], ['Barquisimeto', -69.32, 10.07], ['Ciudad Guayana', -62.64, 8.3], ['Maracay', -67.59, 10.25],
    ['Maturín', -63.18, 9.75], ['Ciudad Bolívar', -63.55, 8.12], ['San Cristóbal', -72.23, 7.77], ['Puerto Ayacucho', -67.62, 5.66],
    ['Cumaná', -64.17, 10.45], ['Coro', -69.67, 11.4], ['Barinas', -70.21, 8.62], ['Tucupita', -62.05, 9.06],
    ['Santa Elena de Uairén', -61.11, 4.6],
  ]),
  peru: R('Peru', ['Lima', -77.04, -12.05], [
    ['Arequipa', -71.54, -16.41], ['Trujillo', -79.03, -8.11], ['Iquitos', -73.25, -3.75], ['Cusco', -71.97, -13.53],
    ['Chiclayo', -79.84, -6.77], ['Piura', -80.63, -5.19], ['Huancayo', -75.21, -12.07], ['Pucallpa', -74.55, -8.38],
    ['Tacna', -70.25, -18.01], ['Puno', -70.02, -15.84], ['Ayacucho', -74.22, -13.16], ['Cajamarca', -78.51, -7.16],
    ['Puerto Maldonado', -69.19, -12.59], ['Chimbote', -78.58, -9.07], ['Tumbes', -80.45, -3.57], ['Tarapoto', -76.36, -6.49],
    ['Ica', -75.73, -14.07], ['Nazca', -74.94, -14.83],
  ]),
  chile: R('Chile', ['Santiago', -70.67, -33.45], [
    ['Valparaíso', -71.62, -33.05], ['Concepción', -73.05, -36.83], ['Antofagasta', -70.4, -23.65], ['Punta Arenas', -70.91, -53.16],
    ['Puerto Montt', -72.94, -41.47], ['La Serena', -71.25, -29.9], ['Temuco', -72.59, -38.74], ['Arica', -70.31, -18.48],
    ['Iquique', -70.15, -20.21], ['Calama', -68.93, -22.46], ['Copiapó', -70.33, -27.37], ['Valdivia', -73.25, -39.81],
    ['Coyhaique', -72.07, -45.57], ['Talca', -71.66, -35.43], ['Puerto Natales', -72.51, -51.73], ['Chaitén', -72.71, -42.92],
  ]),
  bolivia: R('Bolivia', ['La Paz', -68.15, -16.5], [
    ['Santa Cruz', -63.18, -17.78], ['Cochabamba', -66.16, -17.39], ['Sucre', -65.26, -19.04], ['Oruro', -67.11, -17.97],
    ['Potosí', -65.75, -19.58], ['Tarija', -64.73, -21.53], ['Cobija', -68.77, -11.03], ['Riberalta', -66.07, -11.01],
    ['Uyuni', -66.83, -20.46], ['Puerto Suárez', -57.8, -18.96], ['Guayaramerín', -65.36, -10.82],
  ]),
  ecuador: R('Ecuador', ['Quito', -78.47, -0.18], [
    ['Guayaquil', -79.89, -2.19], ['Cuenca', -79.0, -2.9], ['Manta', -80.71, -0.95], ['Loja', -79.2, -4.0],
    ['Esmeraldas', -79.65, 0.97], ['Machala', -79.96, -3.26], ['Puyo', -77.99, -1.49], ['Tena', -77.82, -0.99],
    ['Nueva Loja', -76.89, 0.08], ['Puerto Baquerizo Moreno', -89.61, -0.9],
  ]),
  paraguay: R('Paraguay', ['Asunción', -57.58, -25.26], [
    ['Ciudad del Este', -54.61, -25.51], ['Encarnación', -55.87, -27.33], ['Pedro Juan Caballero', -55.73, -22.55],
    ['Filadelfia', -60.03, -22.35], ['Fuerte Olimpo', -57.87, -21.04],
  ]),
  uruguay: R('Uruguay', ['Montevideo', -56.16, -34.9], [
    ['Salto', -57.96, -31.39], ['Paysandú', -58.08, -32.32], ['Rivera', -55.55, -30.9], ['Punta del Este', -54.95, -34.96],
    ['Tacuarembó', -55.98, -31.71], ['Melo', -54.18, -32.37], ['Colonia del Sacramento', -57.84, -34.47],
  ]),
  guyana: R('Guyana', ['Georgetown', -58.16, 6.8], [
    ['Linden', -58.3, 6.0], ['New Amsterdam', -57.52, 6.25], ['Lethem', -59.8, 3.38], ['Bartica', -58.62, 6.4],
  ]),
};

// The naming style for a country's land when its real names run out (see
// realStyleName in cultures.js): Japanese, Korean, Chinese pinyin,
// Vietnamese, Thai, Malay, Russian and Hindustani forms. Countries not
// listed fall back to the culture of the land.
const LANG = {
  japan: 'ja',
  'south-korea': 'ko',
  'north-korea': 'ko',
  mainland: 'zh',
  roc: 'zh',
  mongolia: 'zh',
  vietnam: 'vi',
  thailand: 'th',
  laos: 'th',
  cambodia: 'th',
  myanmar: 'th',
  malaysia: 'ms',
  indonesia: 'ms',
  brunei: 'ms',
  singapore: 'ms',
  philippines: 'ms',
  russia: 'ru',
  belarus: 'ru',
  ukraine: 'ru',
  kazakhstan: 'ru',
  india: 'hi',
  pakistan: 'hi',
  bangladesh: 'hi',
  nepal: 'hi',
};

// Ruler titles where a region-appropriate one reads naturally; every other
// real realm has a neutral Lord or Lady (REAL_TITLE in cultures.js).
const KING = { m: 'King', f: 'Queen' };
const TITLE = {
  japan: { m: 'Emperor', f: 'Empress' },
  'south-korea': KING,
  thailand: KING,
  cambodia: KING,
  'united-kingdom': KING,
  spain: KING,
  netherlands: KING,
  belgium: KING,
  denmark: KING,
  norway: KING,
  sweden: KING,
  morocco: KING,
  jordan: KING,
  'saudi-arabia': KING,
  russia: { m: 'Tsar', f: 'Tsarina' },
  iran: { m: 'Shah', f: 'Shahbanu' },
  turkey: { m: 'Sultan', f: 'Sultana' },
  mongolia: { m: 'Khan', f: 'Khatun' },
  india: { m: 'Maharaja', f: 'Maharani' },
};

// The people of each country (src/sim/civ/peoples.js): its building style
// and the pool its personal names come from. Every country is listed.
const CENTRAL_AMERICAN = 'centralamerican';
const PEOPLE = {
  mainland: 'chinese', roc: 'roc', japan: 'japanese', 'south-korea': 'korean', 'north-korea': 'korean', mongolia: 'mongolian',
  vietnam: 'vietnamese', laos: 'lao', cambodia: 'khmer', thailand: 'thai', myanmar: 'burmese', malaysia: 'malay', singapore: 'singaporean',
  brunei: 'malay', indonesia: 'indonesian', 'timor-leste': 'timorese', philippines: 'filipino', 'papua-new-guinea': 'papuan',
  india: 'indian', pakistan: 'pakistani', bangladesh: 'bangladeshi', nepal: 'nepali', bhutan: 'bhutanese', 'sri-lanka': 'srilankan',
  afghanistan: 'afghan', kazakhstan: 'kazakh', uzbekistan: 'uzbek', turkmenistan: 'turkmen', kyrgyzstan: 'kyrgyz', tajikistan: 'tajik',
  iran: 'iranian', iraq: 'iraqi', 'saudi-arabia': 'saudi', turkey: 'turkish', syria: 'syrian', jordan: 'jordanian', israel: 'israeli',
  lebanon: 'lebanese', kuwait: 'gulf', qatar: 'gulf', uae: 'gulf', oman: 'omani', yemen: 'yemeni', azerbaijan: 'azerbaijani',
  georgia: 'georgian', armenia: 'armenian', cyprus: 'cypriot', russia: 'russian', germany: 'german', 'united-kingdom': 'british',
  france: 'french', italy: 'italian', spain: 'spanish', portugal: 'portuguese', netherlands: 'dutch', belgium: 'belgian', switzerland: 'swiss',
  austria: 'austrian', czechia: 'czech', slovakia: 'slovak', hungary: 'hungarian', poland: 'polish', denmark: 'danish', norway: 'norwegian',
  sweden: 'swedish', finland: 'finnish', iceland: 'icelandic', ireland: 'irish', belarus: 'belarusian', ukraine: 'ukrainian',
  moldova: 'moldovan', romania: 'romanian', bulgaria: 'bulgarian', serbia: 'serbian', croatia: 'croatian', slovenia: 'slovene',
  bosnia: 'bosnian', montenegro: 'montenegrin', albania: 'albanian', 'north-macedonia': 'macedonian', greece: 'greek', estonia: 'estonian',
  latvia: 'latvian', lithuania: 'lithuanian', egypt: 'egyptian', libya: 'libyan', tunisia: 'tunisian', algeria: 'algerian', morocco: 'moroccan',
  mauritania: 'mauritanian', mali: 'sahelian', niger: 'sahelian', chad: 'sahelian', sudan: 'sudanese', 'south-sudan': 'eastafrican',
  ethiopia: 'ethiopian', somalia: 'somali', kenya: 'eastafrican', uganda: 'eastafrican', tanzania: 'eastafrican', nigeria: 'westafrican',
  ghana: 'westafrican', 'ivory-coast': 'westafrican', senegal: 'westafrican', cameroon: 'centralafrican', 'central-african-republic': 'centralafrican',
  'dr-congo': 'centralafrican', angola: 'southernafrican', zambia: 'southernafrican', zimbabwe: 'southernafrican', mozambique: 'southernafrican',
  namibia: 'southernafrican', botswana: 'southernafrican', 'south-africa': 'southafrican', madagascar: 'malagasy', australia: 'australian',
  'new-zealand': 'newzealander', 'united-states': 'american', canada: 'canadian', mexico: 'mexican', guatemala: CENTRAL_AMERICAN,
  belize: 'westindian', honduras: CENTRAL_AMERICAN, 'el-salvador': CENTRAL_AMERICAN, nicaragua: CENTRAL_AMERICAN, 'costa-rica': CENTRAL_AMERICAN,
  panama: CENTRAL_AMERICAN, cuba: 'caribbean', jamaica: 'westindian', haiti: 'haitian', 'dominican-republic': 'caribbean', bahamas: 'westindian',
  greenland: 'greenlandic', brazil: 'brazilian', argentina: 'argentine', colombia: 'southamerican', venezuela: 'southamerican', peru: 'andean',
  chile: 'southamerican', bolivia: 'andean', ecuador: 'andean', paraguay: 'southamerican', uruguay: 'southamerican', guyana: 'guyanese',
};

// Cities that exist at the start on the whole Earth, Great East Asia and
// North America (docs/REGIONS.md section 4), wherever they fall inside the
// window: placed after the usual starting villages, closer than the usual
// spacing when they must be, never skipped. A region asks for them with
// `must: true`.
const MUST = {
  mainland: ['Shenyang', 'Harbin', 'Urumqi', 'Lhasa', 'Chongqing', 'Nanning'],
  'north-korea': ['Pyongyang', 'Hamhung'],
  'south-korea': ['Seoul'],
  japan: ['Sapporo', 'Kumamoto'],
  'united-states': ['Anchorage', 'Seattle', 'San Diego', 'Houston', 'Chicago', 'Denver', 'San Juan'],
  roc: ['Hong Kong', 'Haikou', 'Fuzhou'],
};

// Copy of a country definition for one region: `first` lists city names to
// move to the front (the cities that should be seeded first on that map),
// `edge: true` lets a realm whose capital lies outside the window take its
// first city inside the window as its seat, and `only` keeps just the named
// cities. `seed: false` lists a country's places for naming only (its land
// lies at the window's edge; a realm may still rise there later). `must`
// asks for the cities that must exist at the start (MUST above).
export function country(id, opts = {}) {
  const c = COUNTRIES[id];
  if (!c) throw new Error('unknown country ' + id);
  let cities = c.cities.slice();
  let capital = { ...c.capital };
  // `capital` seats the realm at another of its cities (the ROC at Taipei on
  // the whole Earth); the old seat becomes its first city
  if (opts.capital && opts.capital !== capital.name) {
    const seat = cities.find((p) => p.name === opts.capital);
    if (seat) {
      cities = [capital, ...cities.filter((p) => p !== seat)];
      capital = { ...seat };
    }
  }
  // `drop` leaves out cities whose land the map does not hold (islands on
  // the Asia Mainland map)
  if (opts.drop) cities = cities.filter((p) => !opts.drop.includes(p.name));
  if (opts.only) cities = cities.filter((p) => opts.only.includes(p.name));
  if (opts.first) {
    const front = opts.first.map((n) => cities.find((p) => p.name === n)).filter(Boolean);
    cities = [...front, ...cities.filter((p) => !front.includes(p))];
  }
  if (opts.extra) cities.push(...opts.extra.map((p) => P(...p)));
  const out = { name: opts.name || c.name, capital, cities, id };
  if (opts.edge) out.edge = true;
  if (opts.color != null) out.color = opts.color;
  if (opts.culture) out.culture = opts.culture;
  if (opts.seed === false) out.seed = false;
  const lang = opts.lang || LANG[id];
  if (lang) out.lang = lang;
  const title = opts.title || TITLE[id];
  if (title) out.title = title;
  const people = opts.people || PEOPLE[id];
  if (people) out.people = people;
  if (opts.must && MUST[id]) out.must = MUST[id].slice();
  // a realm seated elsewhere keeps its old seat among its starting towns
  if (out.must && capital.name !== c.capital.name) {
    out.must.push(c.capital.name);
    out.oldSeat = c.capital.name;
  }
  return out;
}

export const place = P;
