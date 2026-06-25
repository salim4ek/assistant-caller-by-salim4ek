// Tiny WS smoke-test: connects as assistant and as doctor, sends call and accept.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

func connect(token string) *websocket.Conn {
	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/ws", RawQuery: "token=" + token}
	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	return c
}

// listen returns a channel with messages; we use it to capture the call_id.
func listen(c *websocket.Conn, name string) <-chan string {
	out := make(chan string, 16)
	go func() {
		for {
			_, raw, err := c.ReadMessage()
			if err != nil {
				close(out)
				return
			}
			fmt.Printf("[%s] <<< %s\n", name, string(raw))
			out <- string(raw)
		}
	}()
	return out
}

func main() {
	docTok := flag.String("doc", "", "doctor token")
	asstTok := flag.String("asst", "", "assistant token")
	flag.Parse()
	if *docTok == "" || *asstTok == "" {
		fmt.Println("usage: wstest -doc <jwt> -asst <jwt>")
		os.Exit(1)
	}

	doc := connect(*docTok)
	asst := connect(*asstTok)
	defer doc.Close()
	defer asst.Close()

	docMsgs := listen(doc, "doctor")
	asstMsgs := listen(asst, "assistant")

	time.Sleep(500 * time.Millisecond)

	// 1) Doctor calls the assistant
	call := map[string]any{"type": "call", "payload": map[string]string{"to": "a12", "message": "Нужна помощь в кабинете"}}
	raw, _ := json.Marshal(call)
	fmt.Println("[doctor] >>>", string(raw))
	_ = doc.WriteMessage(websocket.TextMessage, raw)

	// 2) Wait for the assistant to receive the "incoming" message
	var callID string
	select {
	case m := <-asstMsgs:
		var env struct {
			Type    string `json:"type"`
			Payload struct {
				CallID string `json:"call_id"`
			} `json:"payload"`
		}
		if err := json.Unmarshal([]byte(m), &env); err == nil && env.Type == "incoming" {
			callID = env.Payload.CallID
		}
	case <-time.After(2 * time.Second):
		log.Fatal("timeout waiting for incoming")
	}
	if callID == "" {
		log.Fatal("no call_id captured")
	}
	fmt.Println(">>> captured call_id:", callID)

	// 3) Assistant accepts
	accept := map[string]any{"type": "accept", "payload": map[string]string{"call_id": callID}}
	raw, _ = json.Marshal(accept)
	fmt.Println("[assistant] >>>", string(raw))
	_ = asst.WriteMessage(websocket.TextMessage, raw)

	// 4) Drain remaining messages for 1s
	timeout := time.After(1 * time.Second)
loop:
	for {
		select {
		case <-docMsgs:
		case <-asstMsgs:
		case <-timeout:
			break loop
		}
	}
	var _ = sync.WaitGroup{}
}
