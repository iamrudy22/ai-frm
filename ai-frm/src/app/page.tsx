import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

/**
 * AIFRM 홈.
 *
 * 월별 자금 리스크 모니터링은 네 지표를 각각 따로 판정한다. 넷 다 자동으로
 * 낸다. 다만 건설경기 인식 지수는 매달 올리는 최신 회차에서 분양회수 이력을
 * 이어 가므로, 사람이 해야 하는 일이 하나 남는다. 무엇이 자동이고 무엇이
 * 아닌지 여기서 드러나 있어야 결과를 잘못 믿지 않는다.
 *
 * 판정 형태도 지표마다 다르다. 대금 회수·유동성 Gap·건설경기 인식 지수는
 * 4단계 등급이고, 적정 시재는 등급 없이 T/F(안정적/적정시재 부족)다.
 */
export default function Home() {
  return (
    <Layout
      contentWidth={720}
      padding={6}
      content={
        <LayoutContent>
          <VStack gap={6}>
            <VStack gap={2}>
              <Heading level={1}>AIFRM</Heading>
              <Text type="supporting">
                월별 자금 리스크 모니터링. 자금수지표와 한국은행 ECOS 지표로 네 지표를 자동으로
                판정합니다.
              </Text>
            </VStack>

            <VStack gap={3}>
              <Heading level={2}>지금 판정하는 지표</Heading>
              <List>
                <ListItem label="대금 회수 위험" description="계획 대비 실적 회수율" />
                <ListItem label="유동성 Gap" description="기초시재 대비 3개월 순지출" />
                <ListItem
                  label="적정 시재"
                  description="LCR 모델 적정시재 대비 현재시재 — 등급 없이 안정적 / 적정시재 부족"
                />
                <ListItem
                  label="건설경기 인식 지수"
                  description="ECOS 경제지표 9종과 분양회수 예측오차의 가중합 — 종합위기단계"
                />
              </List>
              <HStack>
                {/* Button은 클라이언트 컴포넌트라 next/link를 as로 넘길 수 없다.
                    서버 컴포넌트 경계를 함수가 건너지 못한다. 진입 링크 하나뿐이라
                    평범한 <a>로 충분하다. */}
                <Button label="재무위험 선행지표 열기" variant="primary" href="/aifrm" />
              </HStack>
            </VStack>

            <VStack gap={3}>
              <Heading level={2}>사람이 해야 하는 것</Heading>
              <List>
                <ListItem
                  label="회차 세 개 올리기"
                  description="N월 기준이면 N월·N−1월·N−3월 회차로 모든 지표가 채워집니다(8월 기준이면 5·7·8월). 분양회수 예측오차는 N월 회차의 실적과 N−3월 회차의 계획을 씁니다. 저장하지 않으므로 볼 때마다 올립니다"
                />
              </List>
            </VStack>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
