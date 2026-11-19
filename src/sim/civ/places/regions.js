// Regions within the larger real countries (World Map worlds), for realms
// that rise later inside a country's land when no free country name is left:
// a rebel around Rockhampton is the "State of Queensland", one around
// Pekanbaru the "Republic of Sumatra", not a realm named after one city.
// Each entry: [name, longitude, latitude, style]; the style gives the realm's
// form ("State of", "Republic of"). Coordinates are rough region centers.

const S = 'State of',
  R = 'Republic of';

export const REGIONS = [
  // United States
  ['New England', -71.5, 43.5, S], ['New York', -75.5, 42.8, S], ['Pennsylvania', -77.6, 40.9, S], ['Virginia', -78.7, 37.5, S],
  ['the Carolinas', -80.5, 35.0, S], ['Georgia', -83.4, 32.7, S], ['Florida', -81.7, 28.3, S], ['Ohio', -82.8, 40.3, S],
  ['Michigan', -84.7, 43.8, S], ['Illinois', -89.2, 40.0, S], ['Tennessee', -86.3, 35.8, S], ['Louisiana', -91.9, 31.0, S],
  ['Texas', -99.3, 31.3, S], ['Oklahoma', -97.5, 35.6, S], ['Kansas', -98.4, 38.5, S], ['Nebraska', -99.8, 41.5, S],
  ['the Dakotas', -100.3, 46.0, S], ['Minnesota', -94.3, 46.3, S], ['Missouri', -92.5, 38.4, S], ['Colorado', -105.5, 39.0, S],
  ['New Mexico', -106.1, 34.4, S], ['Arizona', -111.7, 34.3, S], ['Utah', -111.7, 39.3, S], ['Nevada', -116.6, 39.3, S],
  ['Montana', -109.6, 47.0, S], ['Wyoming', -107.5, 43.0, S], ['Idaho', -114.6, 44.4, S], ['Oregon', -120.5, 43.9, S],
  ['Washington', -120.4, 47.4, S], ['California', -119.5, 37.2, S], ['Alaska', -150.0, 63.5, S], ['Hawaii', -157.5, 20.8, S],
  ['Puerto Rico', -66.5, 18.2, S],
  // Canada
  ['British Columbia', -124.5, 53.7, R], ['Alberta', -114.5, 54.5, R], ['Saskatchewan', -105.9, 54.0, R], ['Manitoba', -97.4, 54.9, R],
  ['Ontario', -85.3, 50.0, R], ['Quebec', -71.8, 52.5, R], ['the Maritimes', -64.5, 46.0, R], ['Newfoundland', -57.5, 50.5, R],
  ['the Yukon', -135.5, 63.6, R], ['the Northwest', -118.0, 64.8, R], ['Nunavut', -90.0, 66.0, R],
  // Mexico, Central America and the Caribbean
  ['Sonora', -110.7, 29.6, S], ['Chihuahua', -106.1, 28.6, S], ['Baja California', -114.5, 28.5, S], ['Jalisco', -103.6, 20.6, S],
  ['Yucatan', -89.0, 20.0, S], ['Oaxaca', -96.7, 17.0, S], ['Nuevo Leon', -99.8, 25.6, S], ['Veracruz', -96.7, 19.6, S],
  // South America
  ['Amazonas', -63.0, -4.0, S], ['Para', -52.5, -4.0, S], ['Bahia', -41.7, -12.5, S], ['Minas Gerais', -44.5, -18.5, S],
  ['Sao Paulo', -48.5, -22.3, S], ['Rio Grande do Sul', -53.5, -29.8, S], ['Pernambuco', -37.9, -8.4, S], ['Mato Grosso', -55.9, -12.9, S],
  ['Goias', -49.6, -15.9, S], ['Patagonia', -68.5, -45.0, R], ['the Pampas', -62.0, -35.5, R], ['Cuyo', -68.5, -32.5, R],
  ['the Gran Chaco', -61.5, -24.5, R], ['Atacama', -69.8, -24.5, R], ['Araucania', -72.5, -38.5, R], ['the Andes', -74.0, -10.5, R],
  ['the Llanos', -70.5, 6.0, R],
  // Russia and Central Asia
  ['Karelia', 32.5, 63.5, R], ['the Volga', 47.0, 54.5, R], ['the Urals', 60.0, 58.0, R], ['the Caucasus', 44.0, 43.5, R],
  ['Western Siberia', 75.0, 58.5, R], ['Altai', 86.0, 51.5, R], ['Eastern Siberia', 104.0, 58.0, R], ['Yakutia', 129.0, 64.0, R],
  ['the Far East', 135.0, 48.5, R], ['Kamchatka', 159.0, 56.0, R], ['Chukotka', 172.0, 66.0, R], ['Sakhalin', 142.8, 50.5, R],
  ['Pomorye', 42.0, 64.5, R], ['Transbaikalia', 114.0, 52.0, R], ['Taymyr', 95.0, 71.0, R],
  ['the Steppe', 66.0, 50.0, R], ['Semirechye', 77.0, 44.5, R],
  // East and Southeast Asia (the north-south split of China stays as it is)
  ['Hokkaido', 142.8, 43.4, R], ['Tohoku', 140.6, 39.3, R], ['Kanto', 139.6, 36.0, R], ['Chubu', 137.6, 36.3, R],
  ['Kansai', 135.5, 34.7, R], ['Chugoku', 132.7, 34.8, R], ['Shikoku', 133.5, 33.7, R], ['Kyushu', 130.8, 32.6, R],
  ['the Ryukyus', 127.8, 26.4, R],
  ['Sumatra', 101.5, 0.0, R], ['Java', 110.0, -7.3, R], ['Borneo', 114.0, 0.5, R], ['Sulawesi', 120.5, -2.0, R],
  ['Papua', 138.5, -4.5, R], ['the Moluccas', 128.5, -3.0, R], ['Bali and Lombok', 116.0, -8.5, R],
  ['Luzon', 121.0, 16.0, R], ['the Visayas', 123.5, 10.8, R], ['Mindanao', 125.0, 7.5, R],
  ['Sabah', 117.0, 5.4, S], ['Sarawak', 113.5, 2.5, S],
  // South Asia
  ['Punjab', 75.0, 31.0, S], ['Rajasthan', 73.8, 26.6, S], ['Gujarat', 71.5, 22.7, S], ['Maharashtra', 75.7, 19.4, S],
  ['the Deccan', 77.5, 16.5, S], ['Tamil Nadu', 78.5, 11.0, S], ['Kerala', 76.3, 10.3, S], ['Bengal', 88.0, 23.0, S],
  ['Bihar', 85.6, 25.6, S], ['Uttar Pradesh', 80.9, 27.0, S], ['Madhya Pradesh', 78.6, 23.5, S], ['Odisha', 84.4, 20.5, S],
  ['Assam', 92.9, 26.2, S], ['Kashmir', 75.3, 34.1, S], ['Sindh', 68.8, 26.0, R], ['Balochistan', 65.5, 28.5, R],
  // Southwest Asia and Africa
  ['Anatolia', 33.5, 39.0, R], ['Kurdistan', 43.5, 37.0, R], ['Khorasan', 59.0, 35.5, R], ['Fars', 53.0, 29.5, R],
  ['Azarbaijan', 46.5, 38.0, R], ['the Hejaz', 39.5, 23.0, R], ['Najd', 45.0, 25.0, R], ['Al-Hasa', 49.5, 25.0, R],
  ['Upper Egypt', 32.5, 25.5, R], ['the Delta', 31.0, 30.8, R], ['Kabylie', 4.5, 36.5, R], ['the Sahara', 3.0, 26.0, R],
  ['Hausaland', 8.5, 12.0, S], ['Yorubaland', 3.9, 7.5, S], ['Biafra', 7.5, 5.5, S], ['Oromia', 39.5, 7.5, R], ['Tigray', 39.0, 13.8, R],
  ['Katanga', 26.5, -9.5, R], ['Kasai', 22.5, -5.0, R], ['Kivu', 28.5, -2.0, R], ['the Coast', 39.8, -3.5, R],
  ['Natal', 30.5, -28.5, R], ['the Cape', 20.5, -33.0, R], ['the Transvaal', 28.5, -25.0, R], ['the Free State', 26.5, -28.5, R],
  // Australia and Oceania
  ['Queensland', 145.0, -21.0, S], ['New South Wales', 147.0, -32.5, S], ['Victoria', 144.5, -37.0, S], ['Tasmania', 146.6, -42.0, S],
  ['South Australia', 136.0, -30.5, S], ['Western Australia', 121.0, -26.0, S], ['the Northern Territory', 133.4, -19.5, S],
  ['the North Island', 175.5, -38.5, R], ['the South Island', 170.5, -43.8, R],
  // Europe
  ['Scotland', -4.2, 56.8, R], ['Wales', -3.7, 52.3, R], ['Ulster', -6.7, 54.6, R], ['Brittany', -2.8, 48.2, R],
  ['Provence', 6.0, 43.8, R], ['Aquitaine', -0.5, 44.5, R], ['Burgundy', 4.8, 47.2, R], ['Normandy', 0.2, 49.2, R],
  ['Catalonia', 1.6, 41.8, R], ['Andalusia', -4.6, 37.5, R], ['Galicia', -7.9, 42.8, R], ['the Basque Country', -2.6, 43.0, R],
  ['Bavaria', 11.5, 48.8, S], ['Saxony', 13.2, 51.0, S], ['Prussia', 13.5, 52.7, S], ['the Rhineland', 7.2, 50.5, S],
  ['Lombardy', 9.8, 45.6, R], ['Sicily', 14.0, 37.5, R], ['Sardinia', 9.0, 40.1, R], ['Naples', 15.0, 40.8, R],
  ['Silesia', 17.5, 50.8, R], ['Lesser Poland', 21.0, 50.0, R], ['Crimea', 34.2, 45.2, R], ['the Donbas', 38.0, 48.2, R],
  ['Lapland', 24.0, 67.5, R], ['Scania', 13.5, 55.9, R], ['Norrland', 17.0, 64.0, R],
];
