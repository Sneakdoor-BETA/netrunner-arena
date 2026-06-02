(ns web.replay-restore
  (:require
    [cheshire.core :as json]
    [game.core.card :refer [get-card]]
    [game.core.effects :refer [unregister-static-abilities]]
    [game.core.engine :refer [unregister-events]]
    [game.core.finding :refer [find-card]]
    [game.core.hosting :refer [host]]
    [game.core.initializing :refer [card-init]]
    [game.core.moving :refer [move]]
    [game.core.say :refer [system-msg]]
    [game.core.update :refer [update!]]
    [game.utils :refer [to-keyword]]
    [game.replay :as replay]))

(defn- replay-deps [_game]
  {:app-state (atom {})
   :game-state (atom {})
   :last-state (atom {})
   :replay-status (atom {:autoplay false :speed 1600})
   :replay-timeline (atom [])
   :replay-side (atom :spectator)
   :load-notes (fn [] nil)
   :get-remote-annotations (fn [_] nil)})

(defn- find-live-card [state replay-card cid-map]
  (let [live-ref (get @cid-map (:cid replay-card))
        live-card (get-card state live-ref)]
    (when live-card
      {:side (to-keyword (:side live-card))
       :card live-card})))

(defn- check-for-correct-ids [game replay-state]
  (let [state (:state game)]
    (when (not= (get-in @state [:corp :identity :normalizedtitle])
                (get-in @replay-state [:corp :identity :normalizedtitle]))
      (throw (Exception. "Selected Corp ID does not match replay.")))
    (when (not= (get-in @state [:runner :identity :normalizedtitle])
                (get-in @replay-state [:runner :identity :normalizedtitle]))
      (throw (Exception. "Selected Runner ID does not match replay.")))))

(defn- move-all-cards-to-decks [game]
  (doseq [side [:corp :runner]]
    (let [state (:state game)]
      (doseq [card (get-in @state [side :hand])]
        (move state side card :deck {:suppress-event true :force true})))))

(defn- restore-card [game side target-card path]
  (let [state (:state game)
        card (find-card (:title target-card) (get-in @state [side :deck]))]
    (when-not card (throw (Exception. (str "Card " (:title target-card) " not found in deck. Check whether you selected the correct decklists."))))
    (move state side card path {:suppress-event true :force true})))

(defn- restore-cards-at-path [game replay-state side path cid-map]
  (doseq [target-card (get-in @replay-state (cons side path))]
    (let [live-card (restore-card game side target-card path)]
      (swap! cid-map assoc (:cid target-card) live-card))))

(def zones {:runner [:hand :deck :discard :scored :rfg :play-area :current]
            :corp [:hand :deck :discard :scored :rfg :play-area :current]})

(defn- restore-basic-zones [game replay-state cid-map]
  (doseq [side [:corp :runner]
          zone (side zones)]
    (restore-cards-at-path game replay-state side [zone] cid-map)))

(defn- install-paths [replay-state side]
  (if (= side :corp)
    (mapcat (fn [server] [[:servers server :content] [:servers server :ices]])
            (keys (get-in @replay-state [:corp :servers])))
    [[:rig :program] [:rig :hardware] [:rig :resource] [:rig :facedown]]))

(defn- restore-installed-zones [game replay-state cid-map]
  (doseq [side [:corp :runner]
          path (install-paths replay-state side)]
    (restore-cards-at-path game replay-state side path cid-map)))

(defn- restore-card-state [state live-card replay-card]
  (when live-card
    (let [updated (cond-> live-card
                    (contains? replay-card :rezzed) (assoc :rezzed (:rezzed replay-card))
                    (not (contains? replay-card :rezzed)) (dissoc :rezzed)
                    (contains? replay-card :facedown) (assoc :facedown (:facedown replay-card))
                    (not (contains? replay-card :facedown)) (dissoc :facedown)
                    (contains? replay-card :seen) (assoc :seen (:seen replay-card))
                    (not (contains? replay-card :seen)) (dissoc :seen)
                    (contains? replay-card :new) (assoc :new (:new replay-card))
                    (not (contains? replay-card :new)) (dissoc :new)
                    (contains? replay-card :counter) (assoc :counter (:counter replay-card))
                    (not (contains? replay-card :counter)) (dissoc :counter)
                    (contains? replay-card :advance-counter) (assoc :advance-counter (:advance-counter replay-card))
                    (not (contains? replay-card :advance-counter)) (dissoc :advance-counter))]
      (update! state (to-keyword (:side live-card)) updated))))

(defn- restore-basic-zone-card-states [game replay-state cid-map]
  (let [state (:state game)]
    (doseq [side [:corp :runner]
            zone (get zones side)
            replay-card (get-in @replay-state (list* side [zone]))]
      (when-let [{:keys [card]} (find-live-card state replay-card cid-map)]
        (restore-card-state state card replay-card)))))

(defn- restore-hosted-tree
  ([state live-host replay-host cid-map]
   (doseq [replay-card (:hosted replay-host)]
     (let [child-side (to-keyword (:side replay-card))]
       ; the hosted children are not installed on their own, so we need to find them in the deck
       (when-let [live-child (find-card (:title replay-card) (get-in @state [child-side :deck]))]
         (when-let [live-host-card (get-card state live-host)]
           (let [hosted-card (host state child-side live-host-card live-child {:facedown (:facedown replay-card)})]
             (when hosted-card
               (swap! cid-map assoc (:cid replay-card) hosted-card))
             (restore-card-state state hosted-card replay-card)
             (restore-hosted-tree state hosted-card replay-card cid-map))))))))

(defn- restore-card-and-hosted [state replay-card cid-map]
  (when-let [{:keys [card]} (find-live-card state replay-card cid-map)]
    (when card
      (restore-card-state state card replay-card)
      (restore-hosted-tree state card replay-card cid-map))))

(defn- restore-hosted-cards
  [game replay-state cid-map]
  (let [state (:state game)]
    (doseq [side [:corp :runner]
            path (install-paths replay-state side)
            replay-card (get-in @replay-state (cons side path))]
      (restore-card-and-hosted state replay-card cid-map))))

(defn- rehook-single-card [state card]
  (when-let [side (to-keyword (:side card))]
    (when-let [c (get-card state card)]
      (unregister-events state side c)
      (unregister-static-abilities state side c)
      (card-init state side c {:resolve-effect false
                               :init-data false}))))

(defn- rehook-card-tree [state card]
  (rehook-single-card state card)
  (when-let [c (get-card state card)]
    (doseq [h (:hosted c)]
      (rehook-card-tree state h))))

(defn- restore-engine-hooks [game]
  (let [state (:state game)]
    (doseq [server (sort (keys (get-in @state [:corp :servers])))]
      (doseq [card (get-in @state [:corp :servers server :content])]
        (rehook-card-tree state card))
      (doseq [card (get-in @state [:corp :servers server :ices])]
        (rehook-card-tree state card)))
    (doseq [row [:program :hardware :resource :facedown]]
      (doseq [card (get-in @state [:runner :rig row])]
        (rehook-card-tree state card)))
    (doseq [side [:corp :runner]]
      (when-let [id (get-in @state [side :identity])]
        (rehook-single-card state id)))))

(def player-keys
  {:corp [:click :credit :bad-publicity :hand-size :agenda-point :agenda-point-req]
   :runner [:click :credit :run-credit :link :tag :brain-damage :hand-size :agenda-point :agenda-point-req]})

(defn- restore-player-states [game replay-state]
  (let [state (:state game)]
    (doseq [side [:corp :runner]]
      (let [replay-player (get @replay-state side)
            restored (select-keys replay-player (side player-keys))]
        (swap! state update side merge restored)))))

(defn- restore-player-hand-kept [game replay-state]
  (let [state (:state game)]
    (doseq [side [:corp :runner]]
      (when-let [keep (get-in @replay-state [side :keep])]
        (swap! state assoc-in [side :keep] keep)))))

(defn- restore-turn-state [game replay-state]
  (let [state (:state game)
        restored (select-keys @replay-state [:active-player :end-turn :turn])
        restored (assoc restored :active-player (to-keyword (:active-player restored)))]
    (swap! state merge restored)))

(defn setup-state-from-replay [game replay-deps]
  (let [replay-state (:game-state replay-deps)
        cid-map (atom {})]
    (check-for-correct-ids game replay-state)
    (move-all-cards-to-decks game)
    (restore-basic-zones game replay-state cid-map)
    (restore-installed-zones game replay-state cid-map)
    (restore-basic-zone-card-states game replay-state cid-map)
    (restore-hosted-cards game replay-state cid-map)
    (restore-player-states game replay-state)
    (restore-turn-state game replay-state)
    (restore-engine-hooks game)
    (restore-player-hand-kept game replay-state)))

(defn handle-replay-state
  [game {:keys [replay]} {:keys [n]}]
  (when (and replay n)
    (let [history (json/parse-string replay true)
          replay-state (replay-deps game)]
      (reset! (:game-state replay-state) (replay/replay-init-state-from-history history (:gameid game)))
      (replay/populate-replay-timeline! replay-state @(:game-state replay-state))
      (replay/replay-jump-to! replay-state {:n n :d 0})
      (setup-state-from-replay game replay-state)
      (system-msg (:state game) :public "[!] Replay restored")
      game)))
