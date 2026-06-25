import { Link } from 'react-router-dom'
import { Monitor, Smartphone, Power, ListChecks, ArrowLeft, Bell } from 'lucide-react'
import { Layout } from '@/components/Layout'
import { Card, CardContent } from '@/components/ui/card'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-xs font-bold bg-teal-100 text-teal-700 border border-teal-300">{n}</span>
      <span className="text-sm text-foreground/90 pt-0.5">{children}</span>
    </li>
  )
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <h2 className="text-base font-bold flex items-center gap-2 mb-4">
          <Icon className="w-5 h-5 text-teal-600" /> {title}
        </h2>
        <ol className="space-y-3">{children}</ol>
      </CardContent>
    </Card>
  )
}

export function HelpPage() {
  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-5">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Назад
        </Link>
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight">Установка и автозапуск</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Чтобы вызовы и сообщения приходили надёжно (в трее/на телефоне), установите приложение, включите уведомления и автозапуск.
          </p>
        </header>

        <Section icon={Bell} title="Уведомления (нужно и врачу, и ассистенту)">
          <Step n={1}>При первом входе вверху появится жёлтый баннер <b>«Включить уведомления»</b> — нажмите его, затем <b>Разрешить</b>. Это нужно сделать и врачу, и ассистенту.</Step>
          <Step n={2}>В шапке рядом с часами есть <b>колокольчик</b>: зелёный — уведомления <b>включены</b>, зачёркнутый — <b>выключены</b>. Им можно включать/выключать в любой момент.</Step>
          <Step n={3}>Без этого вы пропустите вызов (ассистент) или сообщение от ассистента (врач), когда приложение в фоне или закрыто.</Step>
          <Step n={4}>На iPhone уведомления работают только в установленном на «Домой» приложении (iOS 16.4+) — см. раздел про iPhone ниже.</Step>
        </Section>

        <Section icon={Monitor} title="Компьютер (Windows · Chrome или Edge)">
          <Step n={1}>Откройте сайт в <b>Chrome</b> или <b>Edge</b>.</Step>
          <Step n={2}>Нажмите кнопку <b>«Приложение»</b> в шапке сайта (или значок установки <b>⊕</b> в адресной строке) → <b>Установить</b>. Сайт откроется отдельным окном.</Step>
          <Step n={3}><b>Автозапуск при включении ПК:</b> откройте <code className="px-1 rounded bg-slate-100">edge://apps</code> (в Edge) или <code className="px-1 rounded bg-slate-100">chrome://apps</code> (в Chrome) → правый клик по «NN+ Вызов» → включите <b>«Запускать при входе в систему»</b>.</Step>
          <Step n={4}>В настройках браузера включите <b>«Продолжать выполнять фоновые приложения при закрытии браузера»</b> — тогда уведомления приходят, даже если окно закрыто.</Step>
          <Step n={5}>При первом входе нажмите жёлтый баннер <b>«Включить уведомления»</b> → <b>Разрешить</b> — и врачу, и ассистенту.</Step>
        </Section>

        <Section icon={Smartphone} title="Android (Chrome)">
          <Step n={1}>Откройте сайт в <b>Chrome</b>.</Step>
          <Step n={2}>Нажмите <b>«Приложение»</b> вверху → <b>Установить</b>. Иконка появится на рабочем столе и запускается как обычное приложение.</Step>
          <Step n={3}>Откройте приложение и нажмите <b>«Включить уведомления»</b> → <b>Разрешить</b>.</Step>
          <Step n={4}><b>Важно для фона:</b> Настройки телефона → Приложения → <b>«NN+ Вызов»</b> (или Chrome) → <b>Батарея</b> → выберите <b>«Без ограничений»</b> и разрешите фоновую работу/автозапуск. Иначе телефон «усыпляет» приложение и уведомление приходит только когда вы его откроете (особенно Samsung, Xiaomi, Huawei, Oppo).</Step>
          <Step n={5}>Не закрывайте приложение свайпом из списка недавних — так Android может заблокировать фоновые уведомления.</Step>
        </Section>

        <Section icon={Smartphone} title="iPhone / iPad (ТОЛЬКО Safari)">
          <Step n={1}><b>Важно:</b> ссылку нужно открыть именно в <b>Safari</b>. Если вы открыли её из Telegram/почты — нажмите <b>«•••»</b> и выберите <b>«Открыть в Safari»</b>.</Step>
          <Step n={2}>Внизу нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой ↑).</Step>
          <Step n={3}><b>Пролистайте список вниз</b> и выберите <b>«На экран «Домой»»</b> → <b>Добавить</b>.</Step>
          <Step n={4}>Запускайте приложение <b>с иконки на экране «Домой»</b> и при первом запуске нажмите <b>«Включить уведомления»</b> → <b>Разрешить</b>. Уведомления на iPhone работают только так (iOS 16.4+).</Step>
          <Step n={5}>Проверьте, что телефон <b>не в режиме «Без звука» и не в «Фокусе»</b> — иначе уведомление придёт беззвучно.</Step>
        </Section>

        <Section icon={ListChecks} title="Проверка, что всё работает">
          <Step n={1}>Ассистент: статус <b>«Вы в сети»</b> (зелёная точка) и в админ-панели он показан <b>online</b>.</Step>
          <Step n={2}>Закройте/сверните приложение и проверьте оба направления: вызов врача → ассистенту и сообщение ассистента → врачу. На закрытом приложении должно прийти системное уведомление со звуком.</Step>
          <Step n={3 as number}><Power className="w-3.5 h-3.5 inline -mt-0.5 text-teal-600" /> Перезагрузите ПК — приложение должно открыться само (если включён автозапуск).</Step>
        </Section>
      </div>
    </Layout>
  )
}
