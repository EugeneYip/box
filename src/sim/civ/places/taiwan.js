// Real realms on the Taiwan map: the major cities and counties, each seated
// at its namesake city with real towns as its villages (place names in the
// spellings used in Taiwan). Miaoli is held by Hsinchu, Nantou by Taichung and
// Yunlin by Chiayi. Most important first. Each realm lists its towns and then
// its smaller townships and districts, so that villages founded later nearly
// always take a real name. The map holds only the islands under ROC rule,
// Kinmen and Matsu (Lienchiang) among them; the Fujian coast is open sea.
import { place as P } from './countries.js';

const MAGISTRATE = { m: 'Magistrate', f: 'Magistrate' };
const R = (name, capital, cities, extra = {}) => ({ name, capital: P(...capital), cities: cities.map((c) => P(...c)), lang: 'tw', people: 'taiwanese', title: MAGISTRATE, ...extra });

export default [
  R('Taipei', ['Taipei', 121.56, 25.04], [
    ['Keelung', 121.74, 25.13], ['Tamsui', 121.44, 25.17], ['Banqiao', 121.46, 25.01], ['Xindian', 121.54, 24.97],
    ['Xizhi', 121.66, 25.07], ['Sanxia', 121.37, 24.93], ['Jinshan', 121.64, 25.22], ['Ruifang', 121.81, 25.11],
    ['Wulai', 121.55, 24.86], ['Xinzhuang', 121.45, 25.04], ['Shimen', 121.57, 25.29], ['Pingxi', 121.74, 25.03],
    ['Yingge', 121.35, 24.95], ['Bali', 121.4, 25.15],
    ['Linkou', 121.39, 25.08], ['Luzhou', 121.47, 25.09], ['Sanchong', 121.49, 25.06], ['Tucheng', 121.44, 24.97],
    ['Shulin', 121.42, 25.0], ['Wugu', 121.44, 25.08], ['Taishan', 121.43, 25.06], ['Shenkeng', 121.62, 25.0],
    ['Shiding', 121.66, 24.99], ['Pinglin', 121.71, 24.94], ['Shuangxi', 121.87, 25.03], ['Gongliao', 121.91, 25.02],
    ['Wanli', 121.69, 25.18], ['Sanzhi', 121.5, 25.26], ['Beitou', 121.5, 25.13], ['Shilin', 121.52, 25.09],
    ['Neihu', 121.59, 25.08], ['Nangang', 121.61, 25.05], ['Wenshan', 121.57, 24.99], ['Yonghe', 121.51, 25.01],
    ['Zhonghe', 121.5, 25.0], ['Jiufen', 121.84, 25.11], ['Fulong', 121.94, 25.02],
  ]),
  R('Kaohsiung', ['Kaohsiung', 120.3, 22.63], [
    ['Fengshan', 120.36, 22.63], ['Gangshan', 120.3, 22.79], ['Qishan', 120.48, 22.89], ['Meinong', 120.54, 22.9],
    ['Lujhu', 120.26, 22.86], ['Linyuan', 120.4, 22.51], ['Qieding', 120.18, 22.91], ['Dashu', 120.43, 22.71],
    ['Liugui', 120.63, 22.99], ['Jiaxian', 120.59, 23.11], ['Namasia', 120.7, 23.2], ['Maolin', 120.66, 22.89],
    ['Daliao', 120.4, 22.6], ['Zuoying', 120.29, 22.69],
    ['Nanzi', 120.32, 22.73], ['Renwu', 120.35, 22.7], ['Dashe', 120.35, 22.73], ['Niaosong', 120.36, 22.66],
    ['Qiaotou', 120.31, 22.76], ['Alian', 120.32, 22.88], ['Tianliao', 120.4, 22.87], ['Yanchao', 120.36, 22.79],
    ['Mituo', 120.25, 22.78], ["Yong'an", 120.23, 22.82], ['Hunei', 120.25, 22.9], ['Neimen', 120.46, 22.94],
    ['Shanlin', 120.62, 23.03], ['Xiaogang', 120.34, 22.56], ['Qijin', 120.27, 22.61], ['Gushan', 120.27, 22.65],
    ['Ziguan', 120.23, 22.75], ['Sanmin', 120.32, 22.65], ['Baolai', 120.7, 23.1], ['Tengzhi', 120.76, 23.08],
  ]),
  R('Taichung', ['Taichung', 120.68, 24.15], [
    ['Fengyuan', 120.72, 24.25], ['Dajia', 120.62, 24.35], ['Qingshui', 120.56, 24.27], ['Nantou', 120.66, 23.91],
    ['Puli', 120.97, 23.97], ['Dongshi', 120.83, 24.26], ['Wuqi', 120.52, 24.26], ['Caotun', 120.68, 23.97],
    ['Zhushan', 120.69, 23.76], ['Jiji', 120.79, 23.83], ['Yuchi', 120.93, 23.88], ['Shuili', 120.85, 23.81],
    ['Dali', 120.68, 24.1], ['Shalu', 120.56, 24.23], ['Heping', 121.0, 24.3], ['Xinyi', 120.86, 23.7],
    ['Taiping', 120.72, 24.13], ['Wufeng', 120.7, 24.06], ['Wuri', 120.62, 24.1], ['Longjing', 120.55, 24.2],
    ['Dadu', 120.54, 24.15], ['Houli', 120.71, 24.31], ['Shengang', 120.66, 24.26], ['Tanzi', 120.71, 24.21],
    ['Daya', 120.65, 24.22], ['Shigang', 120.78, 24.28], ['Xinshe', 120.81, 24.23], ['Waipu', 120.65, 24.33],
    ["Da'an", 120.59, 24.35], ['Guoxing', 120.86, 24.04], ['Zhongliao', 120.77, 23.88], ['Mingjian', 120.68, 23.85],
    ['Lugu', 120.75, 23.75], ["Ren'ai", 121.13, 24.03], ['Lishan', 121.25, 24.25], ['Qingjing', 121.16, 24.05],
  ]),
  R('Tainan', ['Tainan', 120.2, 22.99], [
    ['Xinying', 120.32, 23.31], ['Madou', 120.25, 23.18], ['Yongkang', 120.26, 23.03], ['Shanhua', 120.3, 23.13],
    ['Baihe', 120.42, 23.35], ['Yujing', 120.46, 23.12], ['Jiali', 120.18, 23.16], ['Anping', 120.16, 23.0],
    ['Guanmiao', 120.33, 22.96], ['Qigu', 120.14, 23.14], ['Xuejia', 120.18, 23.23], ['Nanxi', 120.48, 23.05],
    ['Xinhua', 120.31, 23.04],
    ['Guiren', 120.29, 22.97], ['Rende', 120.25, 22.97], ['Annan', 120.18, 23.05], ['Xigang', 120.2, 23.12],
    ['Jiangjun', 120.16, 23.21], ['Beimen', 120.12, 23.27], ['Yanshui', 120.27, 23.32], ['Liuying', 120.31, 23.28],
    ['Houbi', 120.36, 23.37], ['Liujia', 120.35, 23.23], ['Guantian', 120.31, 23.19], ['Danei', 120.35, 23.12],
    ['Shanshang', 120.36, 23.1], ['Zuozhen', 120.4, 23.06], ['Longqi', 120.36, 22.96], ['Nanhua', 120.48, 23.04],
    ['Xiaying', 120.26, 23.23],
  ]),
  R('Taoyuan', ['Taoyuan', 121.3, 24.99], [
    ['Zhongli', 121.22, 24.96], ['Daxi', 121.29, 24.88], ['Dayuan', 121.2, 25.06], ['Yangmei', 121.15, 24.91],
    ['Guanyin', 121.08, 25.03], ['Longtan', 121.21, 24.86], ['Fuxing', 121.35, 24.82], ['Luzhu', 121.27, 25.05],
    ['Xinwu', 121.11, 24.97], ['Bade', 121.28, 24.93],
    ['Pingzhen', 121.22, 24.95], ['Guishan', 121.35, 25.03], ['Neili', 121.26, 24.97], ['Caota', 121.14, 25.03],
    ['Zhuwei', 121.24, 25.12],
  ]),
  R('Hsinchu', ['Hsinchu', 120.97, 24.8], [
    ['Zhubei', 121.0, 24.84], ['Miaoli', 120.82, 24.56], ['Zhudong', 121.09, 24.74], ['Hukou', 121.04, 24.9],
    ['Toufen', 120.9, 24.69], ['Guanxi', 121.18, 24.8], ['Tongxiao', 120.68, 24.49], ['Beipu', 121.06, 24.7],
    ['Yuanli', 120.65, 24.44], ['Dahu', 120.86, 24.42], ['Sanyi', 120.77, 24.42], ['Jianshi', 121.2, 24.68],
    ['Nanzhuang', 121.0, 24.6], ['Houlong', 120.79, 24.61], ['Xinfeng', 120.98, 24.9],
    ['Qionglin', 121.08, 24.76], ['Xinpu', 121.07, 24.83], ['Hengshan', 121.12, 24.72], ['Emei', 121.02, 24.69],
    ['Baoshan', 121.0, 24.76], ['Zaoqiao', 120.87, 24.64], ['Touwu', 120.88, 24.58], ['Gongguan', 120.85, 24.5],
    ['Tongluo', 120.79, 24.49], ['Shitan', 120.9, 24.53], ['Sanwan', 120.95, 24.65], ['Zhunan', 120.87, 24.69],
    ["Tai'an", 121.0, 24.45], ['Zhuolan', 120.82, 24.31], ['Xiangshan', 120.92, 24.77], ['Smangus', 121.33, 24.58],
  ]),
  R('Changhua', ['Changhua', 120.54, 24.08], [
    ['Lukang', 120.43, 24.06], ['Yuanlin', 120.58, 23.96], ['Beidou', 120.52, 23.87], ['Hemei', 120.5, 24.11],
    ['Erlin', 120.37, 23.9], ['Xihu', 120.48, 23.96], ['Tianzhong', 120.59, 23.86], ['Fangyuan', 120.32, 23.92],
    ['Xianxi', 120.41, 24.13], ['Dacheng', 120.32, 23.85],
    ['Huatan', 120.56, 24.03], ['Fenyuan', 120.63, 24.02], ['Shetou', 120.58, 23.9], ['Tianwei', 120.53, 23.89],
    ['Pitou', 120.47, 23.89], ['Puyan', 120.46, 24.0], ['Xiushui', 120.5, 24.03], ['Dacun', 120.54, 23.99],
    ['Yongjing', 120.55, 23.92], ['Ershui', 120.62, 23.81], ['Zhutang', 120.43, 23.86], ['Xizhou', 120.49, 23.85],
  ]),
  R('Chiayi', ['Chiayi', 120.45, 23.48], [
    ['Douliu', 120.54, 23.71], ['Huwei', 120.43, 23.71], ['Beigang', 120.3, 23.57], ['Puzi', 120.25, 23.47],
    ['Minxiong', 120.43, 23.55], ['Budai', 120.17, 23.38], ['Alishan', 120.8, 23.51], ['Xiluo', 120.47, 23.8],
    ['Dalin', 120.47, 23.6], ['Mailiao', 120.25, 23.79], ['Taibao', 120.33, 23.46], ['Zhongpu', 120.52, 23.42],
    ['Gukeng', 120.56, 23.64], ['Taixi', 120.2, 23.7], ['Zhuqi', 120.55, 23.52],
    ['Dounan', 120.48, 23.68], ['Tuku', 120.39, 23.68], ['Baozhong', 120.3, 23.69], ['Kouhu', 120.18, 23.58],
    ['Sihu', 120.23, 23.64], ['Yuanchang', 120.31, 23.65], ['Lunbei', 120.4, 23.78], ['Erlun', 120.42, 23.77],
    ['Citong', 120.53, 23.77], ['Linnei', 120.62, 23.76], ['Shuilin', 120.25, 23.57], ['Lucao', 120.31, 23.41],
    ['Yizhu', 120.25, 23.35], ['Xingang', 120.35, 23.55], ['Liujiao', 120.29, 23.5], ['Fanlu', 120.6, 23.43],
    ['Meishan', 120.56, 23.58], ['Dapu', 120.59, 23.3], ['Shuishang', 120.4, 23.43], ['Fenqihu', 120.69, 23.5],
  ]),
  R('Pingtung', ['Pingtung', 120.49, 22.67], [
    ['Donggang', 120.45, 22.47], ['Hengchun', 120.74, 22.0], ['Chaozhou', 120.54, 22.55], ['Fangliao', 120.59, 22.37],
    ['Neipu', 120.57, 22.61], ['Ligang', 120.5, 22.8], ['Fangshan', 120.65, 22.26], ['Checheng', 120.71, 22.07],
    ['Manzhou', 120.84, 22.02], ['Linbian', 120.51, 22.43], ['Liuqiu', 120.37, 22.34], ['Mudan', 120.77, 22.13],
    ['Sandimen', 120.65, 22.72], ['Kenting', 120.8, 21.95], ['Wandan', 120.48, 22.59],
    ['Jiuru', 120.49, 22.74], ['Changzhi', 120.53, 22.68], ['Linluo', 120.52, 22.65], ['Yanpu', 120.46, 22.76],
    ['Gaoshu', 120.6, 22.83], ['Majia', 120.69, 22.68], ['Taiwu', 120.67, 22.59], ['Laiyi', 120.63, 22.53],
    ['Wanluan', 120.59, 22.58], ['Zhutian', 120.54, 22.59], ['Xinpi', 120.55, 22.47], ['Nanzhou', 120.51, 22.49],
    ['Kanding', 120.51, 22.51], ['Xinyuan', 120.46, 22.54], ['Jiadong', 120.55, 22.41], ['Chunri', 120.63, 22.37],
    ['Shizi', 120.7, 22.2], ['Wutai', 120.73, 22.75],
  ]),
  R('Yilan', ['Yilan', 121.75, 24.75], [
    ['Luodong', 121.77, 24.68], ["Su'ao", 121.85, 24.6], ['Toucheng', 121.82, 24.86], ['Jiaoxi', 121.77, 24.83],
    ['Sanxing', 121.66, 24.67], ['Nanao', 121.8, 24.46], ['Datong', 121.6, 24.67], ['Dongshan', 121.78, 24.64],
    ['Zhuangwei', 121.8, 24.77], ['Yuanshan', 121.66, 24.78],
    ['Wujie', 121.8, 24.68], ['Dongao', 121.84, 24.52], ["Nanfang'ao", 121.87, 24.58],
  ]),
  R('Hualien', ['Hualien', 121.6, 23.98], [
    ['Yuli', 121.31, 23.33], ['Fenglin', 121.45, 23.74], ['Ji\'an', 121.57, 23.96], ['Shoufeng', 121.51, 23.86],
    ['Guangfu', 121.42, 23.67], ['Ruisui', 121.38, 23.5], ['Fuli', 121.25, 23.18], ['Fengbin', 121.52, 23.6],
    ['Xincheng', 121.64, 24.13], ['Chongde', 121.66, 24.17],
    ['Xiulin', 121.62, 24.12], ['Wanrong', 121.41, 23.72], ['Zhuoxi', 121.3, 23.35], ['Tianxiang', 121.49, 24.18],
    ['Shitiping', 121.51, 23.49], ['Hongye', 121.37, 23.48], ['Antong', 121.36, 23.28], ['Sanzhan', 121.57, 24.1],
  ]),
  R('Taitung', ['Taitung', 121.15, 22.76], [
    ['Chenggong', 121.38, 23.1], ['Guanshan', 121.16, 23.05], ['Chishang', 121.21, 23.1], ['Taimali', 121.0, 22.61],
    ['Dawu', 120.9, 22.34], ['Luye', 121.14, 22.91], ['Changbin', 121.45, 23.32], ['Donghe', 121.3, 22.97],
    ['Beinan', 121.12, 22.79], ['Green Island', 121.49, 22.66], ['Orchid Island', 121.55, 22.04], ['Dulan', 121.2, 22.88],
    ['Daren', 120.88, 22.29], ['Haiduan', 121.17, 23.1],
    ['Yanping', 121.08, 22.9], ['Jinfeng', 120.95, 22.58], ['Zhiben', 121.06, 22.7], ['Fugang', 121.19, 22.79],
    ['Jinlun', 120.97, 22.53], ['Lidao', 121.03, 23.19],
  ]),
  R('Penghu', ['Magong', 119.57, 23.57], [
    ['Huxi', 119.66, 23.58], ['Baisha', 119.6, 23.66], ['Xiyu', 119.51, 23.6], ["Wang'an", 119.5, 23.37], ['Qimei', 119.43, 23.21],
    ['Jibei', 119.62, 23.73], ['Hujing', 119.52, 23.48], ['Fengkui', 119.6, 23.52], ['Shili', 119.55, 23.53], ['Tongliang', 119.59, 23.65],
  ]),
  R('Kinmen', ['Jincheng', 118.32, 24.43], [
    ['Jinhu', 118.42, 24.44], ['Jinsha', 118.41, 24.49], ['Jinning', 118.33, 24.46], ['Lieyu', 118.24, 24.43],
    ['Shanwai', 118.43, 24.45], ['Guningtou', 118.3, 24.48], ['Shuitou', 118.29, 24.42], ['Xiaojinmen', 118.23, 24.44],
  ]),
  R('Lienchiang', ['Nangan', 119.93, 26.15], [
    ['Beigan', 119.99, 26.22], ['Juguang', 119.94, 25.97], ['Dongyin', 120.49, 26.37], ["Fu'ao", 119.95, 26.16],
    ['Qinbi', 119.98, 26.23], ['Xiju', 119.93, 25.95], ['Dongju', 119.98, 25.96], ['Xiyin', 120.47, 26.37],
  ]),
];
